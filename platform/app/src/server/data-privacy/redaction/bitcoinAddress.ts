import { createHash } from "node:crypto";

/**
 * Checksum validation for the bitcoin address forms the CRYPTO recognizer
 * matches: base58check (the `1…` and `3…` legacy addresses) and bech32 /
 * bech32m (the `bc1…` segwit addresses).
 *
 * WHY THIS EXISTS. The recognizer's pattern describes a SHAPE — 26 to 35
 * characters starting with `1` or `3`, avoiding the four look-alike glyphs —
 * and roughly one in sixty random 32-character hex strings fits it by accident.
 * Every OTel trace id is a random 32-character hex string, so the pattern was
 * replacing trace ids with a redaction marker, permanently, at every privacy
 * level. A shape is not evidence; a checksum is. Both forms here carry one, so
 * the recognizer can prove its own finding instead of guessing at it, which is
 * what lets it keep running on values that otherwise look like identifiers.
 *
 * The odds a random hex string clears either checksum are about one in four
 * billion (a 32-bit check), so this turns a measured 1.75% false-positive rate
 * into one nobody will ever meet.
 */

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const BASE58_DIGIT: ReadonlyMap<string, number> = new Map(
  Array.from(BASE58_ALPHABET, (character, index) => [character, index]),
);

/** Version byte + 20-byte hash + 4-byte checksum: every legacy address. */
const BASE58_ADDRESS_BYTES = 25;
const BASE58_CHECKSUM_BYTES = 4;

/**
 * Decode base58 into bytes, or null when the text holds a character the
 * alphabet does not define. Long multiplication over a byte array rather than
 * BigInt: the input is at most 35 characters, so this is a handful of
 * iterations and keeps the hot ingestion path free of BigInt allocation.
 */
function base58Decode(value: string): Uint8Array | null {
  const bytes: number[] = [0];
  for (const character of value) {
    const digit = BASE58_DIGIT.get(character);
    if (digit === undefined) return null;
    let carry = digit;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // A leading `1` is base58 for a leading zero byte, which the arithmetic above
  // cannot represent; the address version byte can be one, so restore them.
  for (let i = 0; i < value.length && value[i] === "1"; i++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

function sha256(data: Uint8Array): Buffer {
  return createHash("sha256").update(data).digest();
}

/**
 * Whether a legacy address carries its own base58check checksum: the first four
 * bytes of the double SHA-256 of the payload must equal the trailing four bytes.
 */
export function isBase58CheckAddress(value: string): boolean {
  const decoded = base58Decode(value);
  if (!decoded || decoded.length !== BASE58_ADDRESS_BYTES) return false;
  const payload = decoded.subarray(
    0,
    BASE58_ADDRESS_BYTES - BASE58_CHECKSUM_BYTES,
  );
  const checksum = decoded.subarray(
    BASE58_ADDRESS_BYTES - BASE58_CHECKSUM_BYTES,
  );
  const expected = sha256(sha256(payload));
  for (let i = 0; i < BASE58_CHECKSUM_BYTES; i++) {
    if (expected[i] !== checksum[i]) return false;
  }
  return true;
}

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GENERATOR = [
  0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
];
/** BIP-173 (segwit v0) and BIP-350 (segwit v1+) differ only in this constant. */
const BECH32_CONSTANT = 1;
const BECH32M_CONSTANT = 0x2bc830a3;
const BECH32_CHECKSUM_CHARS = 6;

function bech32Polymod(values: readonly number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < BECH32_GENERATOR.length; i++) {
      if ((top >>> i) & 1) checksum ^= BECH32_GENERATOR[i]!;
    }
  }
  return checksum >>> 0;
}

/** The "bc" human-readable part, expanded the way BIP-173 specifies. */
const BC_HRP_EXPANDED = [
  "b".charCodeAt(0) >> 5,
  "c".charCodeAt(0) >> 5,
  0,
  "b".charCodeAt(0) & 31,
  "c".charCodeAt(0) & 31,
];

/**
 * Whether a `bc1…` address carries a valid checksum. Only the mainnet
 * human-readable part is checked, because that is the only prefix the
 * recognizer's pattern matches.
 *
 * The first data character is the witness version, and BIP-350 pairs version 0
 * with the bech32 constant and every later version with the bech32m constant.
 * Accepting either constant for either version would accept BIP-350's own
 * invalid vectors, so the pairing is enforced rather than the two constants
 * simply being tried in turn.
 *
 * BIP-173 requires the whole address to be one case; mixed case is invalid and
 * is rejected here rather than folded away, so this answers the same question
 * a wallet would.
 */
export function isBech32Address(value: string): boolean {
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) return false;
  const lower = value.toLowerCase();
  if (!lower.startsWith("bc1")) return false;
  const data = lower.slice(3);
  if (data.length <= BECH32_CHECKSUM_CHARS) return false;
  const values: number[] = [...BC_HRP_EXPANDED];
  for (const character of data) {
    const index = BECH32_CHARSET.indexOf(character);
    if (index === -1) return false;
    values.push(index);
  }
  const witnessVersion = values[BC_HRP_EXPANDED.length]!;
  const expected = witnessVersion === 0 ? BECH32_CONSTANT : BECH32M_CONSTANT;
  return bech32Polymod(values) === expected;
}

/** Whether a CRYPTO match is a bitcoin address in either of its two forms. */
export function isBitcoinAddress(raw: string): boolean {
  return raw.startsWith("bc1")
    ? isBech32Address(raw)
    : isBase58CheckAddress(raw);
}
