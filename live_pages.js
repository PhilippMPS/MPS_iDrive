'use strict';
/**
 * live_pages.js - gauge pages taken over from Live Data: the same layouts and the same drawing
 * (ld_screens.js is Live Data's screens.js, unchanged), fed from kit/car.js here.
 *
 * PAGES is the whole configuration: a tab name, one of Live Data's layouts and the values in its slot
 * order. MPS Studio can write this file; nothing else has to change to add, drop or rearrange a page.
 *
 *   layouts  dial2 · dial3 · dials2 · dials3 · bars2 · bar3 · nums4  (ld_screens.js LAYOUTS)
 *   values   rpm · speed · coolant · oil · torque · gLong · gLat · gear  (VALUES below)
 *
 * Values that need a request to the engine unit (boost, rail pressure, ignition angle ...) are Live
 * Data's "Engine" values over UDS; they are not in this first version (see README_MPS.md).
 */
const SCR = require('./ld_screens');

const PAGES = [
    { tab: 'Live', layout: 'bar3', values: ['rpm', 'oil', 'coolant', 'speed'] },
    { tab: 'Instruments', layout: 'dial3', values: ['torque', 'gLong', 'gLat', 'gear'] },
];

// key -> [name, unit, decimals, read from car.data()]
const VALUES = {
    rpm: ['Engine speed', 'rpm', 0, (d) => d.rpm],
    speed: ['Speed', 'km/h', 0, (d) => d.speed],
    coolant: ['Coolant', '°C', 0, (d) => d.coolant],
    oil: ['Engine oil', '°C', 0, (d) => d.oil],
    torque: ['Engine torque', 'Nm', 0, (d) => d.torque],
    gLong: ['Longitudinal', 'g', 2, (d) => d.gLong],
    gLat: ['Lateral', 'g', 2, (d) => d.gLat],
    gear: ['Gear', '', 0, null],
};
const HIST_MS = 5 * 60000, HIST_EVERY = 1000;

const isNum = (x) => typeof x === 'number' && isFinite(x);
function gearText(d) {
    if (d.stage === 'P' || d.stage === 'R' || d.stage === 'N') return d.stage;
    if (isNum(d.gear) && d.gear > 0) return (d.stage === 'D' ? 'D' : '') + d.gear;
    if (d.gear === -1) return 'R';
    if (d.gear === 0) return 'N';
    return null;
}

class LivePages {
    constructor() {
        this.hist = {};      // key -> [{ t, n }]
        this.peak = {};      // key -> { n, t }
        this.seen = {};      // key -> { lo, hi }
        this.lastHist = 0;
    }
    tabs() { return PAGES.map((p) => p.tab); }
    has(tab) { return PAGES.some((p) => p.tab === tab); }
    /** the slots of page `tab` from car.data() d, in ld_screens.draw's shape */
    slots(tab, d) {
        const p = PAGES.find((x) => x.tab === tab);
        if (!p) return null;
        const now = Date.now(), sample = now - this.lastHist >= HIST_EVERY;
        if (sample) this.lastHist = now;
        const slots = p.values.map((key) => {
            const def = VALUES[key];
            if (!def) return { empty: true };
            if (key === 'gear') {
                const g = gearText(d);
                return { name: def[0], n: null, text: g || '--', dim: !g, u: '', d: 0, sc: SCR.scale('sig:gear', null, '', null) };
            }
            const n = def[3](d);
            const ok = isNum(n);
            if (ok) {
                const s = this.seen[key] || (this.seen[key] = { lo: n, hi: n });
                s.lo = Math.min(s.lo, n); s.hi = Math.max(s.hi, n);
                const pk = this.peak[key];
                if (!pk || n >= pk.n || now - pk.t > SCR.PEAK_MS) this.peak[key] = { n, t: now };
                if (sample) {
                    const h = this.hist[key] || (this.hist[key] = []);
                    h.push({ t: now, n });
                    while (h.length && now - h[0].t > HIST_MS) h.shift();
                }
            }
            return {
                name: def[0], n: ok ? n : null, text: ok ? null : 'no data', dim: !ok, u: def[1], d: def[2],
                sc: SCR.scale('sig:' + key, null, def[1], this.seen[key]),
                peak: this.peak[key] ? this.peak[key].n : null,
                hist: (this.hist[key] || []).map((x) => x.n),
            };
        });
        return { layout: SCR.layout(p.layout), slots };
    }
}

module.exports = { LivePages, PAGES, VALUES };
