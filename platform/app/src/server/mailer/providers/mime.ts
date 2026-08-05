import type { EmailAttachment } from "./types";

export const sanitizeHeaderValue = (value: string): string =>
  value.replace(/[\r\n]+/g, " ").trim();

export const sanitizeHeaderParam = (value: string): string =>
  sanitizeHeaderValue(value).replace(/(["\\])/g, "\\$1");

/**
 * A header parameter such as `filename`, emitted so that both strict and naive
 * receivers get something usable.
 *
 * A quoted string may only hold ASCII (RFC 5322 §2.2), and RFC 2047
 * encoded-words are not allowed inside one (RFC 2047 §5), so a name like
 * `relatório.csv` can be carried only by the RFC 2231 extended form. That form
 * is emitted alongside a transliterated plain parameter: receivers that
 * understand `filename*` prefer it and the rest fall back to the ASCII name
 * instead of a mangled or rejected header.
 */
export const encodeHeaderParam = (name: string, value: string): string => {
  const clean = sanitizeHeaderValue(value);
  const plain = `${name}="${sanitizeHeaderParam(clean)}"`;
  if (!/[^\x20-\x7E]/.test(clean)) return plain;

  const ascii = clean.replace(/[^\x20-\x7E]/g, "_");
  const extended = encodeURIComponent(clean).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${name}="${sanitizeHeaderParam(ascii)}"; ${name}*=UTF-8''${extended}`;
};

/**
 * A header name is a token: no colon, whitespace or control characters (RFC
 * 5322 §3.6.8). Stripping them stops a crafted name from closing the field and
 * injecting another one, which sanitizing the value alone would not prevent.
 */
export const sanitizeHeaderName = (name: string): string =>
  name.replace(/[^\x21-\x39\x3B-\x7E]/g, "").trim();

/**
 * Caller-supplied headers, cleaned for wire use. Returns undefined when there
 * is nothing to send so callers can omit the field entirely.
 */
export const sanitizeHeaders = (
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined => {
  if (!headers) return undefined;
  const entries = Object.entries(headers)
    .map(
      ([name, value]) =>
        [sanitizeHeaderName(name), sanitizeHeaderValue(value)] as const,
    )
    .filter(([name]) => name !== "");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

/**
 * RFC 2047-encode a header value as a single UTF-8 base64 encoded-word
 * (`=?UTF-8?B?...?=`) when the text contains non-ASCII characters or is long
 * enough to warrant encoding.  Pure ASCII values that fit on one line are
 * passed through unchanged (they are already valid RFC 5322 header text).
 *
 * Encoded-words must be ≤75 chars each (RFC 2047 §2).  We split long inputs
 * into multiple encoded-words separated by CRLF + WSP (header folding).
 */
export const rfc2047EncodeHeader = (value: string): string => {
  // Strip injection characters first
  const clean = value.replace(/[\r\n]+/g, " ").trim();

  // If the text is pure ASCII and short enough, no encoding needed
  const needsEncoding = /[^\x20-\x7E]/.test(clean) || clean.length > 75;
  if (!needsEncoding) return clean;

  // Maximum bytes we can pack into one encoded-word:
  //   =?UTF-8?B?<base64>?=  the wrapper itself is 12 chars
  //   RFC 2047 §2: encoded-word ≤ 75 chars total, so base64 payload ≤ 63 chars
  //   Base64 always pads to a multiple of 4, so the usable maximum is 60 chars
  //   (the next multiple of 4 below 63), encoding 45 input bytes exactly.
  const MAX_INPUT_BYTES = 45;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(clean);

  const words: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    // Don't split a multi-byte UTF-8 sequence across encoded-words:
    // find a safe boundary ≤ MAX_INPUT_BYTES from offset
    let end = Math.min(offset + MAX_INPUT_BYTES, bytes.length);
    // Walk back until we're at a UTF-8 character boundary (high bytes are 10xxxxxx)
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;

    const chunk = bytes.slice(offset, end);
    const b64 = Buffer.from(chunk).toString("base64");
    words.push(`=?UTF-8?B?${b64}?=`);
    offset = end;
  }

  // Fold multiple encoded-words with CRLF + SP between them (RFC 2047 §5 rule)
  return words.join("\r\n ");
};

/**
 * Fold a base64 string into lines of at most 76 characters (RFC 2045 §6.8).
 */
const foldBase64 = (b64: string): string => {
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += 76) {
    chunks.push(b64.slice(i, i + 76));
  }
  return chunks.join("\r\n");
};

export const buildRawMimeMessage = ({
  from,
  to,
  replyTo,
  subject,
  html,
  headers,
  attachments,
}: {
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
  attachments: EmailAttachment[];
}): string => {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // Base64-encode the HTML body so we never emit 8-bit or long raw lines
  const htmlBase64 = foldBase64(Buffer.from(html, "utf-8").toString("base64"));

  const lines = [
    `From: ${sanitizeHeaderValue(from)}`,
    `To: ${to.map(sanitizeHeaderValue).join(", ")}`,
    ...(replyTo ? [`Reply-To: ${sanitizeHeaderValue(replyTo)}`] : []),
    // Custom headers come before Subject so they're unambiguously in the header
    // block. Routed through the same helper the other gateways use, so a name
    // carrying a colon or leading space cannot misparse or fold this header.
    ...Object.entries(sanitizeHeaders(headers) ?? {}).map(
      ([name, value]) => `${name}: ${value}`,
    ),
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
    const base64Content = foldBase64(
      Buffer.from(attachment.content).toString("base64"),
    );
    lines.push(
      `--${boundary}`,
      `Content-Type: ${sanitizeHeaderValue(attachment.contentType)}; ${encodeHeaderParam("name", attachment.filename)}`,
      `Content-Disposition: attachment; ${encodeHeaderParam("filename", attachment.filename)}`,
      `Content-Transfer-Encoding: base64`,
      ``,
      base64Content,
    );
  }

  lines.push(`--${boundary}--`);
  return lines.join("\r\n");
};
