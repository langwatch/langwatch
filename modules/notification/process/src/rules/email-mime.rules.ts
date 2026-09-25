import type { EmailAttachment } from "../channels/email-delivery.channel.ts";

/** Maximum bytes one RFC 2047 encoded-word can carry: wrapper is 12 chars,
 *  word max is 75 (RFC 2047 §2) leaving 63 for base64, padded to a multiple
 *  of four gives 60 usable chars, which encodes 45 input bytes. */
const MAX_ENCODED_WORD_INPUT_BYTES = 45;

/** RFC 2045 §6.8: base64 body lines are at most 76 characters. */
const BASE64_LINE_LENGTH = 76;

/**
 * How an email becomes bytes on the wire. Two jobs, both security-shaped:
 * cleaning caller-supplied headers so a crafted name cannot inject another
 * field, and building the raw multipart message SES needs for attachments.
 */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * A header name is a token: no colon, whitespace or control characters
 * (RFC 5322 §3.6.8) - stripping them stops a crafted name from injecting
 * another field, which sanitizing the value alone would not prevent.
 */
export function sanitizeHeaderName(name: string): string {
  return name.replace(/[^\x21-\x39\x3B-\x7E]/g, "").trim();
}

/**
 * Header parameter encoding for RFC 2231 (extended) and plain forms for
 * compatibility with both strict and naive receivers.
 */
export function encodeHeaderParam(name: string, value: string): string {
  const clean = sanitizeHeaderValue(value);
  const plain = `${name}="${quoteHeaderParam(clean)}"`;

  if (!/[^\x20-\x7E]/.test(clean)) {
    return plain;
  }

  const ascii = clean.replace(/[^\x20-\x7E]/g, "_");
  const extended = encodeURIComponent(clean).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `${name}="${quoteHeaderParam(ascii)}"; ${name}*=UTF-8''${extended}`;
}

/**
 * Caller-supplied headers, cleaned for wire use. Returns undefined when
 * there is nothing to send so callers can omit the field entirely.
 */
export function normalizeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  const entries = Object.entries(headers)
    .map(([name, value]) => [sanitizeHeaderName(name), sanitizeHeaderValue(value)] as const)
    .filter(([name]) => name !== "");

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * RFC 2047-encode header values as UTF-8 base64 when needed, with header
 * folding for long inputs. Pure ASCII values that fit are passed through.
 */
export function rfc2047EncodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  const needsEncoding = /[^\x20-\x7E]/.test(clean) || clean.length > 75;

  if (!needsEncoding) {
    return clean;
  }

  const bytes = new TextEncoder().encode(clean);
  const words: string[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    // Never split a multi-byte UTF-8 sequence across encoded-words: walk
    // back until the boundary is not a continuation byte (10xxxxxx).
    let end = Math.min(offset + MAX_ENCODED_WORD_INPUT_BYTES, bytes.length);

    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) {
      end--;
    }

    words.push(`=?UTF-8?B?${Buffer.from(bytes.slice(offset, end)).toString("base64")}?=`);
    offset = end;
  }

  return words.join("\r\n ");
}

export function buildRawMessage({
  from,
  to,
  replyTo,
  subject,
  html,
  headers,
  attachments,
  boundary,
}: {
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
  attachments: EmailAttachment[];
  /** Unique per message; the caller mints it, which keeps this pure. */
  boundary: string;
}): string {
  // Base64-encode the HTML body so we never emit 8-bit or long raw lines.
  const htmlBase64 = foldBase64(Buffer.from(html, "utf-8").toString("base64"));

  const lines = [
    `From: ${sanitizeHeaderValue(from)}`,
    `To: ${to.map((address) => sanitizeHeaderValue(address)).join(", ")}`,
    ...(replyTo ? [`Reply-To: ${sanitizeHeaderValue(replyTo)}`] : []),
    // Custom headers come before Subject so they're unambiguously in the
    // header block. Routed through the same helper the other gateways use,
    // so a name carrying a colon or leading space cannot misparse or fold
    // this header.
    ...Object.entries(normalizeHeaders(headers) ?? {}).map(([name, value]) => `${name}: ${value}`),
    `Subject: ${rfc2047EncodeHeader(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    htmlBase64,
  ];

  for (const attachment of attachments) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${sanitizeHeaderValue(attachment.contentType)}; ${encodeHeaderParam("name", attachment.filename)}`,
      `Content-Disposition: attachment; ${encodeHeaderParam("filename", attachment.filename)}`,
      `Content-Transfer-Encoding: base64`,
      ``,
      foldBase64(Buffer.from(attachment.content).toString("base64")),
    );
  }

  lines.push(`--${boundary}--`);

  return lines.join("\r\n");
}

function quoteHeaderParam(value: string): string {
  return sanitizeHeaderValue(value).replace(/(["\\])/g, "\\$1");
}

function foldBase64(encoded: string): string {
  const chunks: string[] = [];

  for (let index = 0; index < encoded.length; index += BASE64_LINE_LENGTH) {
    chunks.push(encoded.slice(index, index + BASE64_LINE_LENGTH));
  }

  return chunks.join("\r\n");
}
