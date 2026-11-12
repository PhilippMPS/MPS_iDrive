'use strict';
/**
 * lock.js - MPS PIN lock for the pages that work the car (flap, tune, xDrive): "locked" hides them; showing them
 * again takes the PIN (4 to 6 digits). Locking needs no PIN, only a PIN that is set.
 *
 * Stored in <dataDir>/pin_lock.json (written whole: temp file + rename), never the PIN itself:
 *   { v: 1, on, salt, hash, len, fails, until, hidden }
 *   on = a PIN is set; hidden = the pages are locked (kept over a restart: locked stays locked).
 *   hash = SHA-256 applied ROUNDS times over salt + PIN (pure JS below, no native module needed).
 *   fails / until: wrong entries in a row and the time the pad is blocked until (survives a restart).
 * Forgotten PIN: delete pin_lock.json on the head unit (MPS Studio / SSH); the app then starts with every page
 * shown and no PIN. There is deliberately no master code.
 *
 * The flows (the pad's "mode", null = no pad):
 *   unlock                        PIN -> pages shown
 *   set-new -> set-confirm        a new PIN twice (lockAfterSet: then lock at once)
 *   change-old -> set-new -> ...  change: current PIN, then the new one twice
 *   disable                       current PIN -> no PIN, pages shown
 *   reset                         "Forgot PIN": the reset code MPS makes from the VIN (reset_code.js) -> no PIN,
 *                                 pages shown. Wrong codes count as wrong PINs (the same waits).
 *   activate                      the activation code MPS makes from the VIN -> onActivated(vin, code) (main.js
 *                                 keeps it). Needs no PIN; wrong codes count as wrong PINs too.
 * Pure: no drawing, no ctx. lockedNow() / press(key) / view() are all main.js needs.
 */
const fs = require('fs');
const path = require('path');

const ROUNDS = 2000;
const MIN_LEN = 4, MAX_LEN = 6;
const FREE_FAILS = 4;                 // wrong entries before the pad blocks
const BLOCK_S = [30, 60, 120, 300, 900];   // then blocked this long, growing with each further miss

/* ---------- SHA-256 (FIPS 180-4), bytes in, bytes out ---------- */
const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
function sha256(bytes) {
    const n = bytes.length, total = ((n + 9 + 63) >> 6) << 6, m = new Uint8Array(total);
    m.set(bytes); m[n] = 0x80;
    const bits = n * 8;
    m[total - 4] = (bits >>> 24) & 255; m[total - 3] = (bits >>> 16) & 255; m[total - 2] = (bits >>> 8) & 255; m[total - 1] = bits & 255;
    m[total - 5] = Math.floor(bits / 0x100000000) & 255;
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    const r = (x, k) => (x >>> k) | (x << (32 - k));
    for (let o = 0; o < total; o += 64) {
        for (let i = 0; i < 16; i++) w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
        for (let i = 16; i < 64; i++) {
            const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
        for (let i = 0; i < 64; i++) {
            const t1 = (hh + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
            const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
            hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) { out[4 * i] = h[i] >>> 24; out[4 * i + 1] = (h[i] >>> 16) & 255; out[4 * i + 2] = (h[i] >>> 8) & 255; out[4 * i + 3] = h[i] & 255; }
    return out;
}
const toHex = (b) => Array.prototype.map.call(b, (x) => (x < 16 ? '0' : '') + x.toString(16)).join('');
const utf8 = (s) => Uint8Array.from(Buffer.from(String(s), 'utf8'));
/** the stored hash of a PIN: SHA-256 ROUNDS times over salt + PIN (then over the last digest + salt) */
function hashPin(salt, pin) {
    let d = sha256(utf8(salt + ':' + pin));
    const s = utf8(salt);
    for (let i = 1; i < ROUNDS; i++) { const b = new Uint8Array(d.length + s.length); b.set(d); b.set(s, d.length); d = sha256(b); }
    return toHex(d);
}
function newSalt() {
    try { return require('crypto').randomBytes(16).toString('hex'); } catch (e) { /* no crypto module: still fine */ }
    let s = '';
    for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
}
/** compare two hex strings in constant time */
function same(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let x = 0;
    for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return x === 0;
}

const TITLES = {
    'unlock': 'PIN to show all pages',
    'set-new': 'New PIN',
    'set-confirm': 'Repeat new PIN',
    'change-old': 'Current PIN',
    'disable': 'Current PIN to switch the lock off',
    'reset': 'Reset code from MPS Engineering',
    'activate': 'Activation code from MPS Engineering',
};

class PinLock {
    /** dir = the app's data folder; now = () => ms (tests) */
    constructor(dir, log, now) {
        this.file = path.join(dir, 'pin_lock.json');
        this.log = log || { info() {}, warn() {} };
        this.now = now || Date.now;
        this.st = { v: 1, on: false, salt: '', hash: '', len: 0, fails: 0, until: 0, hidden: false };
        try { Object.assign(this.st, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch (e) { /* none yet: lock off */ }
        if (this.st.on && !(this.st.hash && this.st.salt)) this.st.on = false;    // a damaged file never locks you out
        this.locked = !!(this.st.on && this.st.hidden);
        this.mode = null;                              // the pad's flow, null = no pad
        this.lockAfterSet = false;                     // the lock button without a PIN: set one, then lock
        this.entry = '';
        this.pending = '';                             // set-new's PIN while it is repeated
        this.msg = null;                               // { text, warn }
        this.wheel = 0;                                // the digit picked with Digit + / - (HMI bar fallback)
        this.lastActivity = this.now();
        this.vin = null;                               // the car's VIN for the reset code (main.js reads it)
        this.vinState = 'none';                        // none | reading | ok | missing
        this.resetCheck = null;                        // (vin, code) -> true / false (main.js: reset_code.js)
        this.resetLen = 10;
        this.activateCheck = null;                     // (vin, code) -> true / false
        this.onActivated = null;                       // (vin, code): the activation succeeded
    }
    _vinMode() { return this.mode === 'reset' || this.mode === 'activate'; }
    _maxLen() { return this._vinMode() ? this.resetLen : MAX_LEN; }
    _askCurrent() { return this.mode === 'unlock' || this.mode === 'change-old' || this.mode === 'disable' || this._vinMode(); }
    get enabled() { return !!this.st.on; }
    _save() {
        const tmp = this.file + '.' + process.pid + '.tmp';
        try {
            fs.writeFileSync(tmp, JSON.stringify(this.st));
            fs.renameSync(tmp, this.file);
        } catch (e) { this.log.warn('pin lock: not saved: ' + e); }
    }
    /** seconds the pad is still blocked (0 = free) */
    blockedFor() { return Math.max(0, Math.ceil(((this.st.until || 0) - this.now()) / 1000)); }
    touch() { this.lastActivity = this.now(); }

    get pinSet() { return !!this.st.on; }
    /** hide the pages now (a PIN must be set) */
    lock(why) {
        if (!this.st.on) return false;
        if (!this.locked) this.log.info('pin lock: pages locked' + (why ? ' (' + why + ')' : ''));
        this.locked = true; this.mode = null; this.entry = ''; this.pending = ''; this.msg = null; this.wheel = 0;
        if (!this.st.hidden) { this.st.hidden = true; this._save(); }
        return true;
    }
    _shown() {
        this.locked = false;
        if (this.st.hidden) { this.st.hidden = false; this._save(); }
    }
    /** open a flow: 'unlock' | 'enable' | 'change' | 'disable'; lockAfter (enable): lock once the PIN is saved */
    start(flow, lockAfter) {
        this.entry = ''; this.pending = ''; this.msg = null; this.wheel = 0;
        this.lockAfterSet = !!lockAfter;
        this.mode = flow === 'unlock' ? (this.locked ? 'unlock' : null) : flow === 'enable' ? 'set-new'
            : flow === 'change' ? (this.st.on ? 'change-old' : 'set-new') : flow === 'disable' ? (this.st.on ? 'disable' : null)
                : flow === 'reset' ? (this.st.on ? 'reset' : null) : flow === 'activate' ? 'activate' : null;
        this.touch();
    }
    cancel() { this.mode = null; this.entry = ''; this.pending = ''; this.msg = null; this.lockAfterSet = false; }

    /** a key of the pad: '0'..'9', 'del', 'ok', and for the HMI bar fallback 'up', 'down', 'add' */
    press(key) {
        this.touch();
        if (!this.mode) return;
        if (this.blockedFor() && this._askCurrent()) return;
        if (key === 'up') { this.wheel = (this.wheel + 1) % 10; return; }
        if (key === 'down') { this.wheel = (this.wheel + 9) % 10; return; }
        if (key === 'add') key = String(this.wheel);
        if (/^[0-9]$/.test(key)) {
            if (this.entry.length < this._maxLen()) this.entry += key;
            this.msg = null;
            // the PIN / the reset code go by themselves at their length: no OK needed
            const at = this._vinMode() ? this.resetLen : this.st.len;
            if (this._askCurrent() && this.entry.length === at) this._submit();
            return;
        }
        if (key === 'del') { this.entry = this.entry.slice(0, -1); this.msg = null; return; }
        if (key === 'ok') this._submit();
    }
    _checkCurrent() {
        const ok = this.mode === 'reset' ? !!(this.resetCheck && this.vin && this.resetCheck(this.vin, this.entry))
            : this.mode === 'activate' ? !!(this.activateCheck && this.vin && this.activateCheck(this.vin, this.entry))
                : same(hashPin(this.st.salt, this.entry), this.st.hash);
        if (ok) { this.st.fails = 0; this.st.until = 0; this._save(); return true; }
        this.st.fails = (this.st.fails || 0) + 1;
        const over = this.st.fails - FREE_FAILS;
        if (over > 0) this.st.until = this.now() + BLOCK_S[Math.min(over - 1, BLOCK_S.length - 1)] * 1000;
        this._save();
        this.log.warn('pin lock: wrong ' + (this._vinMode() ? 'code' : 'PIN') + ' (' + this.st.fails + ' in a row)');
        const what = this._vinMode() ? 'Wrong code' : 'Wrong PIN';
        this.msg = { text: over > 0 ? what + ' - wait ' + this.blockedFor() + ' s' : what, warn: true };
        this.entry = '';
        return false;
    }
    _submit() {
        const m = this.mode;
        if (this._vinMode() && !this.vin) { this.entry = ''; this.msg = { text: 'VIN not read yet - ignition on, then try again', warn: true }; return; }
        if (m === 'unlock' || m === 'change-old' || m === 'disable' || this._vinMode()) {
            if (this.entry.length < MIN_LEN) { this.msg = { text: 'At least ' + MIN_LEN + ' digits', warn: true }; return; }
            const code = this.entry;
            if (!this._checkCurrent()) return;
            this.entry = '';
            if (m === 'activate') {
                this.mode = null;
                this.msg = { text: 'Activated - all features unlocked' };
                this.log.info('activation: done');
                if (this.onActivated) this.onActivated(this.vin, code);
                return;
            }
            if (m === 'unlock') { this._shown(); this.mode = null; this.msg = { text: 'All pages shown' }; this.log.info('pin lock: pages shown'); return; }
            if (m === 'change-old') { this.mode = 'set-new'; this.msg = null; return; }
            if (m === 'reset') this.log.warn('pin lock: reset with the VIN code');
            this.st = { v: 1, on: false, salt: '', hash: '', len: 0, fails: 0, until: 0, hidden: false };
            this._save();
            this.locked = false;
            this.mode = null;
            this.msg = { text: m === 'reset' ? 'Reset done - no PIN, all pages shown' : 'PIN removed - all pages shown' };
            this.log.info('pin lock: off');
            return;
        }
        if (m === 'set-new') {
            if (this.entry.length < MIN_LEN) { this.msg = { text: 'At least ' + MIN_LEN + ' digits', warn: true }; return; }
            this.pending = this.entry; this.entry = ''; this.mode = 'set-confirm'; this.msg = null;
            return;
        }
        if (m === 'set-confirm') {
            if (this.entry !== this.pending) {
                this.entry = ''; this.pending = ''; this.mode = 'set-new';
                this.msg = { text: 'The two PINs differ - start again', warn: true };
                return;
            }
            const salt = newSalt();
            this.st = { v: 1, on: true, salt, hash: hashPin(salt, this.pending), len: this.pending.length, fails: 0, until: 0, hidden: this.locked };
            this._save();
            this.entry = ''; this.pending = ''; this.mode = null;
            this.msg = { text: 'PIN saved' };
            this.log.info('pin lock: PIN set (' + this.st.len + ' digits)');
            if (this.lockAfterSet) { this.lockAfterSet = false; this.lock('lock button'); }
        }
    }

    /**
     * Lock again by the setting "PIN lock: lock again": 'close' (main.js calls hidden()), '1' / '5' / '15' minutes
     * untouched, 'ignition' (main.js calls ignitionOff()). Call tick() now and then.
     */
    tick(after) {
        const min = Number(after);
        if (this.st.on && !this.locked && min > 0 && this.now() - this.lastActivity > min * 60000) this.lock(min + ' min untouched');
    }
    hidden(after) { if (after === 'close') this.lock('app closed'); }
    ignitionOff() { this.lock('ignition off'); }

    /** what the pad shows */
    view() {
        return {
            enabled: this.enabled, pinSet: this.pinSet, locked: this.locked, mode: this.mode, title: TITLES[this.mode] || '',
            digits: this.entry.length, len: this._vinMode() ? this.resetLen : this._askCurrent() ? this.st.len : 0,
            vin: this.vin, vinState: this.vinState, canForget: this.st.on && (this.mode === 'unlock' || this.mode === 'change-old' || this.mode === 'disable'),
            max: MAX_LEN, min: MIN_LEN, msg: this.msg, blocked: this.blockedFor(), wheel: this.wheel,
            confirmStep: this.mode === 'set-confirm',
        };
    }
}

module.exports = { PinLock, sha256, hashPin, toHex, MIN_LEN, MAX_LEN, FREE_FAILS };
