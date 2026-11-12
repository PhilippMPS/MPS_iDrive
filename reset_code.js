'use strict';
/**
 * reset_code.js - the codes MPS Engineering makes from the car's VIN (tool: mps_codes.py, kept OUTSIDE this
 * repository), typed by the customer on the pad:
 *   PIN reset   HMAC-SHA256(KEY,     "MPS-PIN-RESET-V1|" + VIN)
 *   activation  HMAC-SHA256(ACT_KEY, "MPS-ACTIVATE-V1|" + VIN)    (unlocks every feature of this car)
 *   -> first 8 bytes as a number, mod 10^10: 10 digits.
 *
 * The same VIN always gives the same code. Two keys: a reset code never activates and the other way round.
 * The keys must stay private (this repository is private): with them anyone can make codes. A new key makes
 * every old code of its kind invalid (change it here and in mps_codes.py together).
 */
const { sha256 } = require('./lock');

const KEY = '162467a1929c59a51ac0af70a0b9347be789c32840f05da38ca264fbc44506f2';
const ACT_KEY = '8bcce0c94f5cc8cada8d4ede7c428d8195039908e7756bf7191fba72d997050c';
const LEN = 10;

function bytes(s) { return Uint8Array.from(Buffer.from(String(s), 'utf8')); }
function hexBytes(h) { return Uint8Array.from(Buffer.from(h, 'hex')); }
function hmac(key, msg) {
    let k = key.length > 64 ? sha256(key) : key;
    const ki = new Uint8Array(64 + msg.length), ko = new Uint8Array(64 + 32);
    for (let i = 0; i < 64; i++) { const b = i < k.length ? k[i] : 0; ki[i] = b ^ 0x36; ko[i] = b ^ 0x5c; }
    ki.set(msg, 64);
    ko.set(sha256(ki), 64);
    return sha256(ko);
}
/** a VIN as the code uses it: upper case, letters and digits only */
const cleanVin = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** the 10-digit code of a VIN: kind 'reset' (default) or 'activate' */
function codeFor(vin, kind) {
    const act = kind === 'activate';
    const d = hmac(hexBytes(act ? ACT_KEY : KEY), bytes((act ? 'MPS-ACTIVATE-V1|' : 'MPS-PIN-RESET-V1|') + cleanVin(vin)));
    let n = 0;
    for (let i = 0; i < 8; i++) n = (n * 256 + d[i]) % 1e10;          // stays exact: below 2^53 at every step
    const s = String(n);
    return '0000000000'.slice(s.length) + s;
}
function check(vin, code, kind) {
    if (cleanVin(vin).length < 11) return false;
    const want = codeFor(vin, kind), got = String(code || '');
    if (got.length !== want.length) return false;
    let x = 0;
    for (let i = 0; i < want.length; i++) x |= want.charCodeAt(i) ^ got.charCodeAt(i);
    return x === 0;
}

const checkActivation = (vin, code) => check(vin, code, 'activate');

module.exports = { codeFor, check, checkActivation, cleanVin, LEN };
