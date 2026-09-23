import { createHash } from "node:crypto";

/**
 * Checksum validation for base58check and bech32/bech32m addresses. The
 * recognizer's SHAPE pattern matches ~1 in 60 random hex strings by accident
 * — every OTel trace id is one — so a checksum cuts that to ~1 in 4 billion.
 */

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const BASE58_DIGIT: ReadonlyMap<string, number> = new Map(
  Array.from(BASE58_ALPHABET, (character, index) => [character, index]),
);

/** Version byte + 20-byte hash + 4-byte checksum: every legacy address. */
const BASE58_ADDRESS_BYTES = 25;
const BASE58_CHECKSUM_BYTES = 4;

/**
 * The two version bytes bitcoin mainnet mints (0x00, 0x05). A checksum alone
 * proves the payload intact, not that it's mainnet — other values (0x06
 * among them) also render with a leading `3`, so this is checked separately.
 */
const BASE58_MAINNET_VERSIONS: ReadonlySet<number> = new Set([0x00, 0x05]);

/**
 * Decodes base58 into bytes, or null on a character outside the alphabet.
 * Long multiplication over a byte array rather than BigInt: at most 35
 * input characters keeps the hot ingestion path free of BigInt allocation.
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
 * Whether a legacy address carries a valid base58check checksum: the first
 * four bytes of the double SHA-256 must equal the trailing four. The decoded
 * version byte must be mainnet, see {@link BASE58_MAINNET_VERSIONS}.
 */
export function isBase58CheckAddress(value: string): boolean {
  const decoded = base58Decode(value);
  if (!decoded || decoded.length !== BASE58_ADDRESS_BYTES) return false;
  if (!BASE58_MAINNET_VERSIONS.has(decoded[0]!)) return false;
  const payload = decoded.subarray(0, BASE58_ADDRESS_BYTES - BASE58_CHECKSUM_BYTES);
  const checksum = decoded.subarray(BASE58_ADDRESS_BYTES - BASE58_CHECKSUM_BYTES);
  const expected = sha256(sha256(payload));
  for (let i = 0; i < BASE58_CHECKSUM_BYTES; i++) {
    if (expected[i] !== checksum[i]) return false;
  }
  return true;
}

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
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
 * The highest witness version BIP-141 defines. Without this bound, a `bc13…`
 * with a valid bech32m checksum decodes to no real program yet still gets
 * classified as an address — the data loss this recognizer was rewritten to stop.
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

/** Whether `value` mixes lowercase and uppercase letters. */
function hasMixedCase(value: string): boolean {
  if (!/[a-z]/.test(value)) return false;
  return /[A-Z]/.test(value);
}

/**
 * Whether a `bc1…` address carries a valid checksum. Only the mainnet HRP is
 * checked. BIP-350 pairs each witness version with its own constant (bech32
 * for 0, bech32m for 1-16) rather than accepting either for either.
 */
export function isBech32Address(value: string): boolean {
  if (hasMixedCase(value)) return false;
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

  const program = values.slice(BC_HRP_EXPANDED.length + 1, values.length - BECH32_CHECKSUM_CHARS);
  return isValidWitnessProgram({ witnessVersion, program });
}

/**
 * Whether the data groups encode a witness program BIP-141 allows. Repacking
 * five-bit groups into bytes catches two ways a checksum-valid string encodes
 * nothing: leftover bits, and non-zero padding — both required by BIP-173.
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
 * Whether a CRYPTO match is a bitcoin address, either form. Read case-
 * insensitively: BIP-173 allows uppercase and QR encoders emit it — routing
 * on lowercase alone once sent that form to the base58 decoder, a false miss.
 */
export function isBitcoinAddress(raw: string): boolean {
  const lower = raw.toLowerCase();
  return lower.startsWith("bc1") ? isBech32Address(raw) : isBase58CheckAddress(raw);
}
