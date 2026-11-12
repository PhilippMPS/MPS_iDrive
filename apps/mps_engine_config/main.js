'use strict';
/**
 * MPS Live App (MPS Engineering) - Engine Config 0.9.3 with:
 *   - always: Live and Instruments (Live Data's gauges: live_pages.js + ld_screens.js), xDrive live and Settings;
 *     the app opens on Live, every time;
 *   - lockable (the pages that work the car): Exhaust Flap, Engine Map, Max Cooling, Burbles, Active Sound, xDrive.
 *     The padlock button in the header (after the badges, gone while locked) hides them at once - no PIN needed to lock, only one set
 *     (none yet: it asks for one first). Shown again: Settings > Security > Enable locked screens -> the PIN.
 *     While hidden their settings are hidden too (app.json "when": _pages) and their commands refused; the flap's
 *     own automatics (Drive mode, hold, the rpm guard) go on as set. Locked stays locked over a restart (lock.js).
 *   - Settings > Security: Enable locked screens, PIN (set / change / remove), Lock screens again (by time, app
 *     closed, ignition off, or only with the padlock).
 *   - activation: the car-working pages, their settings and the padlock exist only once this car is activated with
 *     the code MPS makes from its VIN (Settings > Activation; reset_code.js, data/activation.json). Not activated:
 *     Exhaust Flap off (disarmed), tune and xDrive off - nothing goes to the car.
 *   Without the touch renderer: "Lock screens" in the HMI bar, and the PIN on the LOCK screen's bar (Digit + / -).
 *
 * Live Adjustments - native live tweaks for the BMW MGU (iDrive 7), one tab each:
 *   Exhaust Flap - BMW's own 0x60FD on the DME (controller.js + adapters), always there;
 *   Engine Map / Max Cooling / Burbles / Active Sound - the tune picked in Settings
 *   ("Tuning software": Off, BM3, MHD) gets its own tabs (tune.js). Off sends nothing;
 *   xDrive - EXPERIMENTAL, xDrive off until the ignition cycle (xdrive.js), only with its setting on;
 *   xDrive live - read only: front / rear split, wheel slip, steering, yaw and g (xdrive_live.js), with that setting
 *   or once the car showed it has xDrive.
 *
 * Exhaust Flap modes: OEM (hand the flap back to the DME), OPEN (request it open) and
 * CLOSE (request it shut) — the bottom action buttons — and DRIVE MODE: the flap follows the
 * driving mode (auto.js: Sport -> Open, Comfort / Adaptive -> OEM, Eco Pro -> Close; saved with the
 * settings). On top (auto.js): Hold (Open / Close sent again every 15 s, the DME lets a tester's
 * command go after ~20 s) and "Close: hand back above" (Close paused above that engine speed, and
 * without a live engine speed). The command leaves the app only on a button press or, with Drive
 * mode chosen, on a driving mode change; opening the app sends nothing.
 * Control goes through a per-DME adapter over the car's own diagnostic link
 * (kit/diag.js, reused). With "Control source = Simulated" (the default) or when no
 * validated+armed adapter matches the car, it runs fully simulated and touches
 * nothing. The screen separates requested / accepted / confirmed and never shows a
 * request as done without a real read-back.
 */
const mgu = require('./kit/mgu');
const G = require('./kit/gauges');
const { Canvas } = require('./kit/canvas');
const UI = require('./ui');
const { Controller, REFRESH_KEYS } = require('./controller');
const { TuneControl } = require('./tune');
const { XDriveControl } = require('./xdrive');
const { XDriveLive } = require('./xdrive_live');
const Car = require('./kit/car');
const { AutoFlap } = require('./auto');
const { PinLock } = require('./lock');
const { LivePages } = require('./live_pages');
const MPS = require('./mps_ui');
const { fitText } = require('./kit/text-layout');
const { Recorder } = require('./kit/record');
const RESET = require('./reset_code');

const FES = 'de.bmw.infotainment.drivingexcitement.FES';
const RPM_STALE_MS = 5000;          // the Close rpm guard: an engine speed older than this is none

/** The tabs this car gets: Exhaust Flap always, the picked tune's pages, xDrive when switched on, xDrive live with
 * it or on a car that showed it has xDrive. */
function pagesFor(f, xdrive, live, liveTabs, locked) {
    const free = liveTabs.concat(['xDrive live']);
    if (locked) return free;
    return free.concat(['Exhaust Flap'], f.map ? ['Engine Map'] : [], f.cooling ? ['Max Cooling'] : [],
        f.burbles ? ['Burbles'] : [], f.asd ? ['Active Sound'] : [], xdrive ? ['xDrive'] : []);
}
const START = 'Live';
const LOCK_KEYS = { BTN_LK_UP: 'up', BTN_LK_DOWN: 'down', BTN_LK_ADD: 'add', BTN_LK_DEL: 'del', BTN_LK_OK: 'ok' };
// the settings that work the car: hidden while the pages are locked (app.json "when"), and put back if changed then
const PROTECTED = ['arm', 'hold', 'closeLimit', 'tuner', 'xdrive'];

// eased valve angle toward the current state (0 = shut, 1 = open)
function targetAngle(v) {
    const s = v.confirmed !== 'UNKNOWN' ? v.confirmed : v.requested;
    if (s === 'OPEN') return 1;
    if (s === 'CLOSED') return 0;
    if (s === 'OEM') return 0.18;          // DME in control: shown slightly ajar, dimmed
    return 0.5;
}

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const controller = new Controller(ctx);
        // engine speed for Max Cooling's rpm threshold: live values only, never the demo drive
        // xDrive (experimental) also wants speed and the selector: live values only as well
        const car = new Car(ctx, ['rpm', 'speed', 'gear', 'condition', 'accel', 'temps', 'torque']);
        const tune = new TuneControl(ctx, { rpm: () => { const d = car.data(); return d.demo ? null : d.rpm; } });
        const xdrive = new XDriveControl(ctx, car);
        const xlive = new XDriveLive(ctx, car);
        let angle = 0.18;
        let page = START;                   // by name: the tune's tabs come and go with the setting
        const lock = new PinLock(ctx.dataDir, log);
        lock.resetCheck = RESET.check;
        lock.activateCheck = RESET.checkActivation;
        // the activation: kept with its VIN and code, and checked again at every start
        const ACT_FILE = require('path').join(ctx.dataDir, 'activation.json');
        const readAct = () => { try { return JSON.parse(require('fs').readFileSync(ACT_FILE, 'utf8')); } catch (e) { return null; } };
        let activated = (() => { const a = readAct(); return !!(a && RESET.checkActivation(a.vin, a.code)); })();
        // the pages that work the car are out: not activated, or locked with the PIN
        const restricted = () => !activated || lock.locked;
        lock.resetLen = RESET.LEN;
        const live = new LivePages();
        const fit = (cv, s, size, max, opt) => fitText(cv, s, size, max, opt);
        let loop = null, lockLoop = null;
        const repaint = () => { if (lockLoop && lockLoop.kick) lockLoop.kick(); return loop && loop.kick ? loop.kick() : render(); };
        // the kit runs the screen (touch renderer): the pad's keys are on the page, the LOCK screen is not needed
        const ownNow = () => !!(ctx.display && typeof ctx.display.own === 'function' && ctx.display.own());
        // every frame gets the padlock button after the badges (G.frame's action)
        // locked: no padlock at all (showing the pages again is only in Settings > Security)
        const action = () => (restricted() ? null : { icon: 'unlock', color: 'text' });
        const GX = Object.assign({}, G, { frame: (cv, t, tabs, sel, badges) => G.frame(cv, t, tabs, sel, badges, action()) });
        // the Close rpm guard's engine speed: live and fresh only, never the demo drive
        const rpm = () => {
            const d = car.data();
            if (d.demo || !Number.isFinite(d.rpm) || d.rpm < 0 || !car.lastCar || Date.now() - car.lastCar > RPM_STALE_MS) return null;
            return d.rpm;
        };
        // what the flap should do (the buttons, Drive mode, hold, the rpm guard): every command goes through the controller
        const auto = new AutoFlap({ controller, get: (k) => settings.get(k), set: (k, v) => settings.set(k, v), rpm, log, onChange: () => repaint() });

        // the four mode presses, each kicks a repaint (used by both the HMI bar and
        // the on-canvas buttons the kit draws when the app owns the screen)
        const press = (mode) => () => { const p = auto.press(mode); repaint(); return p.then(repaint).catch((e) => log.error('action', e)); };
        // a tune action: repaint at once (shows "Sending…"), then again with the DME's answer
        const tuneAct = (fn) => () => { const p = fn(); repaint(); return p.then(repaint).catch((e) => log.error('tune', e)); };
        // the commands of the lockable pages: refused while they are locked
        const guard = (fn) => function () {
            lock.touch();
            if (restricted()) { log.warn('command refused (' + (activated ? 'pages locked' : 'not activated') + ')'); repaint(); return null; }
            return fn.apply(null, arguments);
        };
        const acts0 = {
            oem: press('OEM'), open: press('OPEN'), close: press('CLOSED'), drive: press('DRIVE'),
            map: (n) => tuneAct(() => tune.setMap(n)),
            cooling: (on) => tuneAct(() => tune.setCooling(on)),
            aggDown: () => { tune.stepAggression(-0.5); repaint(); },
            aggUp: () => { tune.stepAggression(0.5); repaint(); },
            burblesApply: tuneAct(() => tune.applyBurbles(false)),
            burblesOff: tuneAct(() => tune.applyBurbles(true)),
            asd: (on) => tuneAct(() => tune.setAsd(on)),
            xdriveOff: tuneAct(() => xdrive.requestOff()),
            xdriveOn: tuneAct(() => xdrive.requestOn()),
        };
        const acts = {};
        Object.keys(acts0).forEach((k) => {
            const a = acts0[k];
            // map / cooling / asd make the press function from an argument: guard what they return
            acts[k] = ['map', 'cooling', 'asd'].indexOf(k) >= 0 ? (x) => guard(a(x)) : guard(a);
        });
        acts.pin = (k) => { lock.press(k); afterPin(); };
        acts.pinCancel = () => { lock.cancel(); afterPin(); };
        // "Forgot PIN": the reset code MPS makes from the VIN - read it from the DME (UDS 22 F190, read only)
        const readVin = async () => {
            if (lock.vin) return;
            // the emulator has no car: a test VIN there only (never on the head unit)
            if (Object.prototype.hasOwnProperty.call(process.env, 'MGU_EMU_CLOSED')) { lock.vin = 'WBA0EMULATOR00001'; lock.vinState = 'ok'; return; }
            const link = controller.link;
            if (!link || !link.available || !link.readDid) { lock.vinState = 'missing'; return; }
            lock.vinState = 'reading'; repaint();
            try {
                const r = await link.readDid([0xF1, 0x90], 3000);
                const v = r && r.ok ? RESET.cleanVin(r.data.map((c) => String.fromCharCode(c)).join('')) : '';
                if (v.length >= 11) { lock.vin = v; lock.vinState = 'ok'; } else lock.vinState = 'missing';
            } catch (e) { lock.vinState = 'missing'; }
            log.info('pin lock: VIN for the reset code ' + (lock.vin ? 'read' : 'not available'));
        };
        acts.pinForgot = () => { lock.start('reset'); readVin().then(repaint).catch((e) => log.error('vin', e)); repaint(); };
        const pages = () => pagesFor(tune.features(), xdrive.enabled, xlive.seen, live.tabs(), restricted());

        const render = async () => {
            const v = controller.view();
            const tgt = targetAngle(v);
            angle += (tgt - angle) * 0.25;            // simple ease per frame
            if (Math.abs(tgt - angle) < 0.003) angle = tgt;
            v.angle = angle;
            v.requested = auto.desired;          // the word when there is no read-back
            v.selected = auto.selected();        // the button lit: DRIVE MODE, or the mode pressed (Close stays lit while paused)
            v.note = auto.note();
            const list = pages();
            if (list.indexOf(page) < 0) page = list[0];   // a tab that went away (disarmed / not detected)
            v.pages = list;
            v.page = page;
            v.tune = tune.view();
            if (page === 'xDrive' || page === 'xDrive live') {
                const r = xdrive.tick();             // DBE1 read now and then, only on this tab
                if (r) r.then(repaint).catch((e) => log.error('xdrive', e));
                v.xdrive = xdrive.view();
                if (page === 'xDrive live') v.xlive = xlive.view();
            }
            const t = ctx.theme();
            const cv = ctx.canvas(UI.W, UI.H) || new Canvas(UI.W, UI.H);
            if (cv.own && ui.isVisible('LOCK')) ui.close('LOCK');   // the renderer came (back): its pad has keys
            v.lock = lock.view();
            if (lock.mode) MPS.drawPad(cv, GX, t, v, acts);
            else if (live.has(page)) { v.live = live.slots(page, car.data()); MPS.drawLive(cv, GX, t, v, fit); }
            else UI.draw(cv, GX, t, v, acts);     // acts → the kit draws OEM/OPEN/CLOSE, active one red
            await ui.image('MAIN_GFX', cv);
        };
        // the LOCK screen (no touch renderer): the same pad, worked from its HMI bar
        const renderLock = async () => {
            const cv = new Recorder(UI.W, UI.H);
            MPS.drawPad(cv, GX, ctx.theme(), { lock: lock.view(), pages: pages(), page }, acts);
            await ui.image('LOCK_GFX', cv);
        };

        loop = ctx.loop('MAIN', 20, render);
        lockLoop = ctx.loop('LOCK', 10, renderLock);

        /* ---------- the PIN lock: which pages, the padlock, Settings > Security ---------- */
        // the hidden settings the Settings' "when" go by: the pages' state and whether a PIN is set
        let syncing = false;
        const sync = () => {
            syncing = true;
            try {
                const pg = restricted() ? 'locked' : 'shown', pn = lock.pinSet ? 'yes' : 'no', ac = activated ? 'yes' : 'no';
                if (settings.get('_act') !== ac) settings.set('_act', ac);
                if (settings.get('activate') !== 'none') settings.set('activate', 'none');
                if (settings.get('_pages') !== pg) settings.set('_pages', pg);
                if (settings.get('_pin') !== pn) settings.set('_pin', pn);
                if (settings.get('screens') !== !lock.locked) settings.set('screens', !lock.locked);
                if (settings.get('pinNew') !== 'none') settings.set('pinNew', 'none');
                if (settings.get('pinEdit') !== 'keep') settings.set('pinEdit', 'keep');
                ui.visible('BTN_LOCK', !restricted());          // the HMI bar's "Lock screens" (no touch renderer) too
            } finally { syncing = false; }
        };
        let snap = null;                 // the car-working settings as they were when the pages were locked
        const snapshot = () => { snap = {}; PROTECTED.forEach((k) => { snap[k] = settings.get(k); }); };
        const closeSettings = () => {
            const d = ctx.display;
            if (d && d.sheet) d.closeSheet();
            if (ui.isVisible('SETTINGS')) ui.close('SETTINGS');
        };
        // a pad flow opens over the page (without the touch renderer on the LOCK screen)
        const openPad = (flow, lockAfter) => {
            lock.start(flow, lockAfter);
            if (!lock.mode) return repaint();
            if (flow === 'activate' || flow === 'reset') readVin().then(repaint).catch((e) => log.error('vin', e));
            closeSettings();
            if (!ownNow()) setTimeout(() => { if (lock.mode && !ownNow()) ui.open('LOCK'); }, 300);
            return repaint();
        };
        const afterPin = () => {
            if (!lock.mode && ui.isVisible('LOCK')) ui.close('LOCK');
            if (restricted()) { if (!snap) snapshot(); } else snap = null;
            if (pages().indexOf(page) < 0) page = START;
            sync();
            repaint();
        };
        const lockPages = (why) => {
            if (!lock.lock(why)) return false;
            snapshot();
            if (pages().indexOf(page) < 0) page = START;
            sync();
            repaint();
            return true;
        };
        // the padlock: locks at once; no PIN yet - set one first, then lock. Locked: unlocking is in Settings > Security.
        const padlock = () => {
            lock.touch();
            if (lock.mode || !activated) return repaint();
            if (lock.locked) { log.info('pin lock: padlock pressed while locked - unlock in Settings > Security'); return repaint(); }
            if (lock.pinSet) return lockPages('padlock');
            return openPad('enable', true);
        };
        if (ctx.onHeaderAction) ctx.onHeaderAction(padlock);
        ui.onClick('BTN_LOCK', padlock);
        if (ctx.hideButton) ctx.hideButton('BTN_LOCK');            // the kit's screen has the padlock in the header
        Object.keys(LOCK_KEYS).forEach((b) => ui.onClick(b, () => { lock.press(LOCK_KEYS[b]); afterPin(); }));
        // not activated: the car-working settings off, so nothing (Drive mode, hold) can reach the car
        const allOff = () => { [['arm', 'off'], ['tuner', 'off'], ['xdrive', 'off']].forEach(([k, v]) => { if (settings.get(k) !== v) settings.set(k, v); }); };
        if (!activated) { syncing = true; try { allOff(); } finally { syncing = false; } }
        lock.onActivated = (vin, code) => {
            try {
                const tmp = ACT_FILE + '.' + process.pid + '.tmp';
                require('fs').writeFileSync(tmp, JSON.stringify({ v: 1, vin, code, at: new Date().toISOString() }));
                require('fs').renameSync(tmp, ACT_FILE);
            } catch (e) { log.error('activation: not saved', e); }
            activated = true;
            log.info('activation: features unlocked for ' + vin);
        };
        if (restricted()) snapshot();
        sync();
        // Settings > Security, and the car-working settings put back while locked
        settings.onChange((key) => {
            if (syncing) return;
            if (restricted() && snap && Object.prototype.hasOwnProperty.call(snap, key) && settings.get(key) !== snap[key]) {
                log.warn('setting ' + key + ' changed while ' + (activated ? 'locked' : 'not activated') + ' - put back');
                settings.set(key, snap[key]);
                return;
            }
            if (key === 'activate' && settings.get('activate') === 'enter') { sync(); openPad('activate'); return; }
            if (key === 'screens') {
                const want = !!settings.get('screens');
                if (want && lock.locked) { sync(); openPad('unlock'); }               // shown again: only with the PIN
                else if (!want && !lock.locked) { sync(); if (lock.pinSet) { closeSettings(); lockPages('settings'); } else openPad('enable', true); }
            } else if (key === 'pinNew' && settings.get('pinNew') === 'set') { sync(); openPad('enable'); }
            else if (key === 'pinEdit' && settings.get('pinEdit') !== 'keep') {
                const v = settings.get('pinEdit');
                sync();
                openPad(v === 'remove' ? 'disable' : 'change');
            }
        });
        // shown / hidden: the app opens on Live, every time; "When the app is closed" locks then
        let away = true, awayTimer = null;
        const anyShown = () => ['MAIN', 'LOCK', 'SETTINGS'].some((s) => ui.isVisible(s));
        if (ui.onVisible) ui.onVisible((name, on) => {
            if (on) {
                if (awayTimer) { clearTimeout(awayTimer); awayTimer = null; }
                if (away && !lock.mode) page = START;
                away = false;
                return;
            }
            // another screen of ours opening over this one hides it for a moment: only a real leave counts
            if (awayTimer) clearTimeout(awayTimer);
            awayTimer = setTimeout(() => {
                awayTimer = null;
                if (anyShown()) return;
                away = true;
                lock.cancel();
                if (settings.get('lockAfter') === 'close' && lock.pinSet && !lock.locked) lockPages('app closed');
            }, 1500);
        });
        // minutes untouched, ignition off
        let lastCond = null;
        setInterval(() => {
            const after = settings.get('lockAfter');
            if (lock.pinSet && !lock.locked) {
                const min = Number(after);
                if (min > 0 && Date.now() - lock.lastActivity > min * 60000) lockPages(min + ' min untouched');
            }
            const c = car.data().condition;
            if (Number.isFinite(c)) {
                if (lastCond !== null && lastCond >= 7 && c <= 5 && after === 'ignition' && lock.pinSet && !lock.locked) lockPages('ignition off');
                lastCond = c;
            }
            if (lock.mode && lock.blockedFor()) repaint();          // the countdown
        }, 1000);

        // we draw the four mode buttons on the canvas (active = red, like the other
        // apps), so take them off the HMI bottom bar; SETTINGS stays in the bar.
        ['BTN_OPEN', 'BTN_CLOSE', 'BTN_OEM', 'BTN_DRIVE'].forEach((b) => ctx.hideButton && ctx.hideButton(b));
        ui.onClick('BTN_OPEN', acts.open);        // kept as a fallback if the bar button shows (refused while locked)
        ui.onClick('BTN_CLOSE', acts.close);
        ui.onClick('BTN_OEM', acts.oem);
        ui.onClick('BTN_DRIVE', acts.drive);
        ui.onClick('BTN_PAGE', () => { lock.touch(); lock.cancel(); const l = pages(); page = l[(l.indexOf(page) + 1) % l.length]; return render(); });
        ctx.onTab((i) => { lock.touch(); lock.cancel(); const l = pages(); if (l[i]) page = l[i]; return render(); });
        // the DME is looked at again when the flap's or the tune's setting changes, or (armed) while none was found
        // yet: it may have been asleep at start-up. A theme change with the DME found sends nothing.
        const lost = () => controller.armedSetting && !(controller.ident && controller.ident.present);
        settings.onChange((key) => Promise.resolve((REFRESH_KEYS.indexOf(key) >= 0 || lost()) && controller.refresh())
            .then(() => key === 'tuner' && tune.refresh())
            .then(() => key === 'xdrive' && xdrive.refresh())
            .then(() => auto.settingsChanged(key))
            .then(repaint).catch((e) => log.error('settings', e)));

        // the driving mode (notified on change), also while the app is not on screen: Drive mode follows it
        ctx.signals.watch(FES, '1', {
            statusFESVehicleDynamicSwitchHMI: (s) => {
                const p = auto.driveMode(s && s.actualValueModeDrivingExperience);
                if (p) p.then(repaint);
            },
        }, log).then((s) => log.info('drive mode ' + (s && s.error ? 'error: ' + s.error : 'subscribed')));
        // the Close rpm guard, also while the app is not on screen
        setInterval(() => { auto.tick().catch((e) => log.error('rpm', e)); }, 250);

        await controller.start();        // read-only: detect DME + read state, no actuation
        await tune.start(controller.link);   // nothing at all while "Tuning software" is Off
        await xdrive.start(controller.link); // nothing at all while "xDrive (experimental)" is Off
        await xlive.start();
        // the diagnostic link often comes up after the app started (at boot): detect again then
        // (the car came up: the DME starts on its own strategy, so what is wanted - Drive mode's - goes again)
        if (controller.link) controller.link.onAvailable((on) => controller.refresh().then(() => tune.refresh())
            .then(() => xdrive.refresh()).then(() => (on ? auto.linkUp() : null)).then(repaint).catch((e) => log.error('link', e)));
        await render();
        log.info('mps_engine_config ready (' + (activated ? 'activated' : 'NOT activated') + ', pages ' + (lock.locked ? 'locked' : 'shown') + ', PIN ' + (lock.pinSet ? 'set' : 'not set') + ') - exhaust_control (source=' + controller.source + ', adapter=' + controller.adapter.name + ')');
    },
});
