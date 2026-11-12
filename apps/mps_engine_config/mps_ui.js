'use strict';
/**
 * mps_ui.js - what MPS added to Engine Config's screen, PURE draw functions as ui.js:
 *   drawLive(cv, G, t, v, fit)        a Live Data gauge page (ld_screens.js)
 *   drawPad(cv, G, t, v, act)         the PIN pad (unlock, set / change / remove the PIN), over the page
 * Buttons only where the kit runs the screen (cv.own, mgu-render with touch). Without it the lock is
 * worked from the LOCK screen's HMI bar (Digit + / Digit - / Enter digit / Delete / OK): the pad then
 * shows the digit wheel instead of the keys.
 */
const SCR = require('./ld_screens');

const W = 1600;
const BADGE = (v, t) => [v.simulated ? { text: 'SIM', color: t.warn || '#d29922' } : null];

function drawLive(cv, G, t, v, fit) {
    cv.clear(t.bg);
    G.frame(cv, t, v.pages, v.pages.indexOf(v.page), BADGE(v, t));
    const live = v.live;
    if (!live) return cv;
    const y = G.TOP + 8, h = G.pageBottom(cv) - y - (cv.own ? G.MARGIN : 8);
    SCR.draw(cv, t, G, live.layout, live.slots, { x: 24, y, w: W - 48, h }, false, -1, fit);
    return cv;
}

/** a padlock, open or shut, centred on cx / cy (about 2.4 r high) */
function padlock(cv, G, t, cx, cy, r, open, col) {
    const bw = r * 2, bh = r * 1.55, by = cy - bh * 0.15;
    const sx = open ? cx + r * 0.55 : cx, sy = by - (open ? r * 0.35 : 0);
    // the shackle: a ring's upper half and its two legs
    cv.arc(sx, sy, r * 0.62, r * 0.84, -90, 90, col);
    cv.fillRect(sx - r * 0.84, sy, r * 0.22, r * 0.45 + (open ? r * 0.35 : 0), col);
    cv.fillRect(sx + r * 0.62, sy, r * 0.22, r * 0.45 + (open ? 0 : 0), col);
    cv.roundRect(cx - bw / 2, by, bw, bh, r * 0.22, col);
    cv.circle(cx, by + bh * 0.42, r * 0.17, t.bg);
    cv.fillRect(cx - r * 0.06, by + bh * 0.42, r * 0.12, bh * 0.3, t.bg);
}

/** the PIN dots: shown as many as the PIN has (unlock) or up to the most (a new PIN) */
function dots(cv, G, t, cx, y, p) {
    const n = p.len || Math.max(p.min, Math.min(p.max, p.digits + 1));
    const r = 13, gap = 22, w = n * 2 * r + (n - 1) * gap;
    let x = cx - w / 2 + r;
    const S = t.sel || t.accent;
    for (let i = 0; i < n; i++) {
        if (i < p.digits) cv.circle(x, y, r, S);
        else { cv.circle(x, y, r, G.withAlpha('#ffffff', 0.35)); cv.circle(x, y, r - 3, t.panel || t.bg); }
        x += 2 * r + gap;
    }
}

function drawPad(cv, G, t, v, act) {
    const p = v.lock, own = !!cv.own;
    cv.clear(t.bg);
    G.frame(cv, t, v.pages, -1, BADGE(v, t));
    const bottom = G.pageBottom(cv);
    G.panel(cv, t, 24, G.TOP, W - 48, G.BOTTOM - G.TOP, null);
    const midY = (G.TOP + bottom) / 2;
    const lx = own ? 520 : W / 2;               // the left column's centre (the keys on the right)

    if (p.mode !== 'reset' && p.mode !== 'activate') padlock(cv, G, t, lx, midY - 120, 42, !p.locked, p.locked ? (t.crit || '#ef2b2d') : (t.go || '#2fd27a'));
    cv.text(p.mode === 'activate' ? 'ACTIVATION' : 'SECURITY', lx, midY - 18, 22, t.dim, { align: 'center', font: 'bold', spacing: 1.5 });
    cv.text(p.title, lx, midY + 26, p.mode === 'reset' || p.mode === 'activate' ? 30 : 36, t.text, { align: 'center', font: 'bold' });
    if (p.mode === 'reset' || p.mode === 'activate') {
        // the VIN the customer tells MPS (the code is made from it)
        const vt = p.vin ? p.vin : p.vinState === 'reading' ? 'Reading the VIN ...' : 'VIN not available - ignition on';
        cv.text('VIN', lx, midY - 140, 18, t.dim, { align: 'center', font: 'bold', spacing: 2 });
        cv.text(vt, lx, midY - 100, p.vin ? 34 : 24, p.vin ? t.text : (t.warn || '#d29922'), { align: 'center', font: 'bold', spacing: 2 });
        cv.text('Send this VIN to MPS Engineering for the code', lx, midY - 62, 18, t.dim, { align: 'center', font: 'label' });
    }
    dots(cv, G, t, lx, midY + 82, p);
    if (p.blocked) cv.text('Too many wrong PINs - wait ' + p.blocked + ' s', lx, midY + 140, 20, t.warn || '#d29922', { align: 'center', font: 'label' });
    else if (p.msg) cv.text(p.msg.text, lx, midY + 140, 20, p.msg.warn ? (t.warn || '#d29922') : (t.go || '#2fd27a'), { align: 'center', font: 'label' });
    else if (!p.len) cv.text(p.min + ' to ' + p.max + ' digits, then OK', lx, midY + 140, 18, t.dim, { align: 'center', font: 'label' });

    if (!own) {
        // the HMI bar works the lock: show the digit the wheel is on
        cv.roundRect(lx - 48, midY + 166, 96, 76, 14, G.withAlpha('#ffffff', 0.08));
        cv.text(String(p.wheel), lx, midY + 224, 56, t.sel || t.accent, { align: 'center', font: 'num' });
        cv.text('Digit + / Digit -  then  Enter digit', lx, midY + 268, 16, t.dim, { align: 'center', font: 'label' });
        return cv;
    }
    // the keys: 1 2 3 / 4 5 6 / 7 8 9 / DEL 0 OK
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
    const bw = 150, bh = 66, gx = 22, gy = 18, x0 = 1040, y0 = midY - (4 * bh + 3 * gy) / 2;
    keys.forEach((k, i) => {
        const x = x0 + (i % 3) * (bw + gx), y = y0 + Math.floor(i / 3) * (bh + gy);
        const label = k === 'del' ? 'Del' : k === 'ok' ? 'OK' : k;
        const opts = { key: 'pin_' + k, busy: !!p.blocked };
        if (k === 'ok') Object.assign(opts, { primary: true, color: t.sel || t.accent });
        G.button(cv, t, x, y, bw, bh, label, () => act.pin(k), opts);
    });
    const by = bottom - G.MARGIN - 56;
    if (p.canForget && act.pinForgot) {
        G.button(cv, t, lx - 240, by, 220, 56, 'Cancel', act.pinCancel, { key: 'pin_cancel' });
        G.button(cv, t, lx + 20, by, 220, 56, 'Forgot PIN', act.pinForgot, { key: 'pin_forgot' });
    } else G.button(cv, t, lx - 110, by, 220, 56, 'Cancel', act.pinCancel, { key: 'pin_cancel' });
    return cv;
}

module.exports = { drawLive, drawPad };
