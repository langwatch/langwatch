import { createHash } from "node:crypto";

/**
 * Checksum validation for the two bitcoin address forms the CRYPTO recognizer matches:
 * base58check (`1…`/`3…` legacy) and bech32/bech32m (`bc1…` segwit). The recognizer's pattern
 * is a SHAPE that ~1 in 60 random 32-character hex strings satisfies by accident — and every
 * OTel trace id is one, so unchecked it was redacting trace ids permanently. A checksum
 * proves the finding instead of guessing: the odds of clearing one by accident are ~1 in 4
 * billion, turning a measured 1.75% false-positive rate into one nobody will ever meet.
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
 * The two version bytes bitcoin mainnet mints: 0x00 (pay-to-public-key-hash) and 0x05
 * (pay-to-script-hash). The checksum alone proves the payload intact, not that this is really
 * a mainnet address: several of the other 254 values — 0x06 among them — also render with a
 * leading `3`, so without checking the version byte they'd pass as legacy addresses too.
 * Reading the byte confirms independently, rather than trusting the text just decoded.
 */
const BASE58_MAINNET_VERSIONS: ReadonlySet<number> = new Set([0x00, 0x05]);

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
 * The decoded version byte must also be one bitcoin mainnet mints, see
 * {@link BASE58_MAINNET_VERSIONS}.
 */
export function isBase58CheckAddress(value: string): boolean {
  const decoded = base58Decode(value);
  if (!decoded || decoded.length !== BASE58_ADDRESS_BYTES) return false;
  if (!BASE58_MAINNET_VERSIONS.has(decoded[0]!)) return false;
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

/**
 * The highest witness version BIP-141 defines. The first data character is read
 * from a 32-character alphabet, so it can carry 17 through 31 as easily as a
 * real version — and those decode to no segwit program at all. Without this
 * bound a `bc13…` string that happens to carry a valid bech32m checksum is
 * classified as an address and replaced with a marker, which is the data loss
 * this whole recognizer was rewritten to stop.
 */
const MAX_WITNESS_VERSION = 16;

/**
 * The witness program bounds BIP-141 sets: 2 to 40 bytes in general, and for
 * version 0 exactly the 20 bytes of a public-key hash or the 32 of a script
 * hash. A length outside these encodes no output anyone can pay to.
 */
const MIN_WITNESS_PROGRAM_BYTES = 2;
const MAX_WITNESS_PROGRAM_BYTES = 40;
const P2WPKH_PROGRAM_BYTES = 20;
const P2WSH_PROGRAM_BYTES = 32;

/** The "bc" human-readable part, expanded the way BIP-173 specifies. */
const BC_HRP_EXPANDED = [
  "b".charCodeAt(0) >> 5,
  "c".charCodeAt(0) >> 5,
  0,
  "b".charCodeAt(0) & 31,
  "c".charCodeAt(0) & 31,
];

/**
 * Whether a `bc1…` address carries a valid checksum. Only the mainnet human-readable part is
 * checked, since that's the only prefix the recognizer's pattern matches. BIP-350 pairs the
 * witness version with one specific constant — bech32 for version 0, bech32m for 1 to 16 —
 * rather than accepting either for either, which would accept BIP-350's own invalid test
 * vectors; a version above 16 is rejected outright ({@link MAX_WITNESS_VERSION}).
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
  if (witnessVersion > MAX_WITNESS_VERSION) return false;
  const expected = witnessVersion === 0 ? BECH32_CONSTANT : BECH32M_CONSTANT;
  if (bech32Polymod(values) !== expected) return false;

  const program = values.slice(
    BC_HRP_EXPANDED.length + 1,
    values.length - BECH32_CHECKSUM_CHARS,
  );
  return isValidWitnessProgram({ witnessVersion, program });
}

/**
 * Whether the data groups after the witness version encode a witness program BIP-141 allows.
 * `program` arrives as five-bit groups; repacking them into bytes catches the two ways a
 * checksum-valid string can still encode nothing — leftover bits that don't fall away
 * cleanly, and non-zero padding bits. BIP-173 requires both checks, and a decoder that skips
 * them accepts strings no wallet will spend to.
 */
function isValidWitnessProgram({
  witnessVersion,
  program,
}: {
  witnessVersion: number;
  program: readonly number[];
}): boolean {
  let accumulator = 0;
  let bits = 0;
  let bytes = 0;
  for (const group of program) {
    accumulator = ((accumulator << 5) | group) & 0x7ff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes++;
    }
  }
  // Leftover bits are padding, so there must be fewer than a whole group of
  // them and every one must be zero.
  if (bits >= 5 || ((accumulator << (8 - bits)) & 0xff) !== 0) return false;

  if (bytes < MIN_WITNESS_PROGRAM_BYTES || bytes > MAX_WITNESS_PROGRAM_BYTES) {
    return false;
  }
  if (witnessVersion === 0) {
    return bytes === P2WPKH_PROGRAM_BYTES || bytes === P2WSH_PROGRAM_BYTES;
  }
  return true;
}

/**
 * Whether a CRYPTO match is a bitcoin address in either of its two forms. The prefix is read
 * case-insensitively because BIP-173 defines segwit addresses as case-insensitive and QR
 * encoders emit the uppercase form — routing on the lowercase spelling alone sent that form
 * to the base58 decoder, which rejects it on the first out-of-alphabet character, a rejection
 * that reads like a verdict and isn't one. {@link isBech32Address} still refuses the mixed
 * case BIP-173 forbids.
 */
export function isBitcoinAddress(raw: string): boolean {
  return raw.toLowerCase().startsWith("bc1")
    ? isBech32Address(raw)
    : isBase58CheckAddress(raw);
}
