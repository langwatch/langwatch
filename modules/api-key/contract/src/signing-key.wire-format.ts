/**
 * Braid wire format v1, the portable half (ADR-183 §4): the attribute a signature travels as and
 * the message it signs. The SDK signer (sdks/typescript, braids/sign-baggage.ts) writes exactly
 * what this reads. No Node import and no DOM global: the trace module reuses it at span admission.
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The baggage entry, and the span attribute, a signature travels as. */
export const BRAID_SIGNATURE_ATTRIBUTE = "langwatch.signature";
/** The first line of every signed message, naming the wire format version. */
export const BRAID_SIGNATURE_DOMAIN = "langwatch-braid-signature-v1";
/** An entry key a braid may sign. */
export const BRAID_ENTRY_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
/** A signing key's public id; the first `_` after `lwsk_` ends it. */
export const SIGNING_KEY_PUBLIC_ID_PATTERN = /^[A-Za-z0-9]+$/;
/** Every signing key's text starts with this, then `<publicId>_<secret>`. */
export const SIGNING_KEY_PREFIX = "lwsk_";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const braidEntryKeySchema = z
  .string()
  .regex(BRAID_ENTRY_KEY_PATTERN)
  .refine((key) => key !== BRAID_SIGNATURE_ATTRIBUTE);

const braidSignatureSchemaDefinition = z
  .object({
    v: z.literal(1),
    kid: z.string().regex(SIGNING_KEY_PUBLIC_ID_PATTERN),
    keys: z.array(braidEntryKeySchema).min(1),
    sig: z.string().regex(BASE64URL_PATTERN),
  })
  // Sorted and distinct, as the signer writes them: any other order signs a different message.
  .refine(({ keys }) => keys.every((key, index) => index === 0 || keys[index - 1]! < key));
export interface BraidSignatureSchema extends Named<typeof braidSignatureSchemaDefinition> {}
export const braidSignatureSchema: BraidSignatureSchema = braidSignatureSchemaDefinition;
/** A decoded `langwatch.signature`: the key's public id, the signed entry keys and the HMAC. */
export type BraidSignature = z.infer<typeof braidSignatureSchema>;

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Throws for text that is not base64url. By hand: the contract has no DOM or Node globals. */
function bytesOfBase64Url(text: string): number[] {
  if (!BASE64URL_PATTERN.test(text) || text.length % 4 === 1) throw new Error("not base64url");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text) {
    buffer = (buffer << 6) | BASE64URL_ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  return bytes;
}

/** How many bytes a UTF-8 sequence starting with `lead` holds; 0 when no sequence starts so. */
function utf8SequenceLength(lead: number): number {
  if (lead < 0x80) return 1;
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0;
}

const UTF8_LEAST_CODE_POINT = [0, 0, 0x80, 0x800, 0x10000];

/** Throws for bytes that are not well-formed UTF-8: stray, truncated, overlong or surrogate. */
function textOfUtf8(bytes: readonly number[]): string {
  let text = "";
  let index = 0;
  while (index < bytes.length) {
    const lead = bytes[index] ?? 0;
    const length = utf8SequenceLength(lead);
    if (length === 0 || index + length > bytes.length) throw new Error("not UTF-8");
    let codePoint = length === 1 ? lead : lead & (0xff >> (length + 1));
    for (let offset = 1; offset < length; offset += 1) {
      const next = bytes[index + offset] ?? 0;
      if ((next & 0xc0) !== 0x80) throw new Error("not UTF-8");
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    const surrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
    const overlong = codePoint < (UTF8_LEAST_CODE_POINT[length] ?? 0);
    if (overlong || surrogate || codePoint > 0x10ffff) throw new Error("not UTF-8");
    text += String.fromCodePoint(codePoint);
    index += length;
  }
  return text;
}

/** The signature an attribute carries, or undefined for anything wire format v1 does not write. */
export function parseBraidSignature({
  attribute,
}: {
  attribute: string;
}): BraidSignature | undefined {
  let envelope: unknown;
  try {
    envelope = JSON.parse(textOfUtf8(bytesOfBase64Url(attribute)));
  } catch {
    return undefined;
  }
  const parsed = braidSignatureSchema.safeParse(envelope);
  return parsed.success ? parsed.data : undefined;
}

/** The signed message, or `malformed` for entries wire format v1 never signs. */
export type BraidSignatureMessage =
  | Readonly<{ kind: "message"; text: string }>
  | Readonly<{ kind: "malformed" }>;

/**
 * The message a signature covers: the domain line, the trace id in lower-case hex, then one
 * `<key>=<value>` per entry in ascending code-point order. A key outside the rule or a value
 * holding a line break is malformed, which verification treats as a failed signature.
 */
export function braidSignatureMessage({
  traceId,
  entries,
}: {
  traceId: string;
  entries: Readonly<Record<string, string>>;
}): BraidSignatureMessage {
  const keys = Object.keys(entries);
  if (keys.length === 0) return { kind: "malformed" };
  for (const key of keys) {
    const value = entries[key];
    if (!BRAID_ENTRY_KEY_PATTERN.test(key) || key === BRAID_SIGNATURE_ATTRIBUTE) {
      return { kind: "malformed" };
    }
    if (typeof value !== "string" || /[\r\n]/.test(value)) return { kind: "malformed" };
  }
  // Keys are ASCII by the pattern, so UTF-16 order is code-point order.
  keys.sort();
  const lines = keys.map((key) => `${key}=${entries[key]}`);
  return {
    kind: "message",
    text: [BRAID_SIGNATURE_DOMAIN, traceId.toLowerCase(), ...lines].join("\n"),
  };
}
