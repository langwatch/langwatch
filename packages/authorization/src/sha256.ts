/**
 * SHA-256 of a UTF-8 string as lowercase hex, synchronous and platform-neutral: this package
 * carries no Node types and Web Crypto only digests asynchronously. FIPS 180-4, section 6.2.
 */
const ROUND_CONSTANTS = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL_HASH = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const rotateRight = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

/** The message padded to whole 64-byte blocks, its bit length in the last eight bytes. */
function padded(bytes: Uint8Array): DataView {
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const block = new Uint8Array(length);
  block.set(bytes);
  block[bytes.length] = 0x80;
  const view = new DataView(block.buffer);
  const bits = bytes.length * 8;
  view.setUint32(length - 8, Math.floor(bits / 0x1_0000_0000));
  view.setUint32(length - 4, bits >>> 0);
  return view;
}

/** UTF-8 bytes of a string; the package's library has no `TextEncoder`. */
function utf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    if (point < 0x80) bytes.push(point);
    else if (point < 0x800) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    else if (point < 0x10000) {
      bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    } else {
      bytes.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

export function sha256Hex(text: string): string {
  const view = padded(utf8(text));
  const hash = [...INITIAL_HASH];
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < view.byteLength; offset += 64) {
    for (let t = 0; t < 16; t += 1) schedule[t] = view.getUint32(offset + t * 4);
    for (let t = 16; t < 64; t += 1) {
      const w15 = schedule[t - 15] ?? 0;
      const w2 = schedule[t - 2] ?? 0;
      const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
      const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
      schedule[t] = ((schedule[t - 16] ?? 0) + s0 + (schedule[t - 7] ?? 0) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let t = 0; t < 64; t += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const first = (h + sum1 + choice + (ROUND_CONSTANTS[t] ?? 0) + (schedule[t] ?? 0)) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sum0 + majority) >>> 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + first) >>> 0, c, b, a, (first + second) >>> 0];
    }
    [a, b, c, d, e, f, g, h].forEach((word, index) => {
      hash[index] = ((hash[index] ?? 0) + word) >>> 0;
    });
  }
  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}
