/** Base62 alphabet: 0-9, A-Z, a-z */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ALPHABET_LENGTH = ALPHABET.length;

// Create lookup tables for faster encoding/decoding
const ENCODE_LOOKUP = new Map<string, number>();
const DECODE_LOOKUP = new Map<number, string>();

// Initialize lookup tables
for (let i = 0; i < ALPHABET_LENGTH; i++) {
  const char = ALPHABET[i];
  ENCODE_LOOKUP.set(char, i);
  DECODE_LOOKUP.set(i, char);
}

/**
 * Error thrown when base62 encoding/decoding fails
 */
export class Base62Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Base62Error";
  }
}

/**
 * Encodes a byte array to base62 string
 * @param input - The byte array to encode
 * @returns Base62 encoded string
 */
export function encode(input: Uint8Array): string {
  if (input.length === 0) {
    return "";
  }

  // Convert to BigInt for handling large numbers
  let num = 0n;
  for (let i = 0; i < input.length; i++) {
    num = (num << 8n) | BigInt(input[i]);
  }

  if (num === 0n) {
    return "0";
  }

  const result: string[] = [];

  while (num > 0n) {
    const remainder = Number(num % BigInt(ALPHABET_LENGTH));
    result.unshift(DECODE_LOOKUP.get(remainder)!);
    num = num / BigInt(ALPHABET_LENGTH);
  }

  return result.join("");
}

/**
 * Decodes a base62 string to byte array
 * @param input - The base62 string to decode
 * @returns Decoded byte array
 * @throws {Base62Error} If the input contains invalid characters
 */
export function decode(input: string): Uint8Array {
  if (input.length === 0) {
    return new Uint8Array(0);
  }

  // Validate input
  for (const char of input) {
    if (!ENCODE_LOOKUP.has(char)) {
      throw new Base62Error("Invalid character in base62 string");
    }
  }

  // Using BigInt to handle large numbers, don't remove the stray `n`
  let num = 0n;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const value = ENCODE_LOOKUP.get(char)!;
    num = num * BigInt(ALPHABET_LENGTH) + BigInt(value);
  }

  if (num === 0n) {
    return new Uint8Array([0]);
  }

  // Convert BigInt back to bytes
  const bytes: number[] = [];

  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num = num >> 8n;
  }

  return new Uint8Array(bytes);
}
