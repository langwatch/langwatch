import type { EmailAttachment } from "./types";

export const sanitizeHeaderValue = (value: string): string =>
  value.replace(/[\r\n]+/g, " ").trim();

export const sanitizeHeaderParam = (value: string): string =>
  sanitizeHeaderValue(value).replace(/(["\\])/g, "\\$1");

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
  //   =?UTF-8?B?<base64>?=  — the wrapper itself is 12 chars
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
    // Custom headers come before Subject so they're unambiguously in the header block
    ...Object.entries(headers ?? {}).map(
      ([name, value]) =>
        `${sanitizeHeaderValue(name)}: ${sanitizeHeaderValue(value)}`,
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
      `Content-Type: ${sanitizeHeaderValue(attachment.contentType)}; name="${sanitizeHeaderParam(attachment.filename)}"`,
      `Content-Disposition: attachment; filename="${sanitizeHeaderParam(attachment.filename)}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      base64Content,
    );
  }

  lines.push(`--${boundary}--`);
  return lines.join("\r\n");
};
