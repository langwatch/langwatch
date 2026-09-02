import type { EmailAttachment } from "../ports/email-delivery.port";

/** Maximum bytes one RFC 2047 encoded-word can carry.
 *
 *  `=?UTF-8?B?<base64>?=` — the wrapper is 12 characters, an encoded-word is
 *  at most 75 (RFC 2047 §2), so the base64 payload is at most 63; base64 pads
 *  to a multiple of four, so the usable maximum is 60 characters, which
 *  encodes exactly 45 input bytes. */
const MAX_ENCODED_WORD_INPUT_BYTES = 45;

/** RFC 2045 §6.8: base64 body lines are at most 76 characters. */
const BASE64_LINE_LENGTH = 76;

/**
 * How an email becomes bytes on the wire.
 *
 * Two jobs, and both are security-shaped rather than cosmetic: cleaning
 * caller-supplied headers so a crafted name cannot close a field and inject
 * another one, and building the raw multipart message SES needs whenever a
 * send carries attachments or custom headers.
 */
export class EmailMimeService {
  static create(): EmailMimeService {
    return new EmailMimeService();
  }

  private constructor() {}

  sanitizeHeaderValue(value: string): string {
    return value.replace(/[\r\n]+/g, " ").trim();
  }

  /**
   * A header name is a token: no colon, whitespace or control characters (RFC
   * 5322 §3.6.8). Stripping them stops a crafted name from closing the field
   * and injecting another one, which sanitizing the value alone would not
   * prevent.
   */
  sanitizeHeaderName(name: string): string {
    return name.replace(/[^\x21-\x39\x3B-\x7E]/g, "").trim();
  }

  /**
   * A header parameter such as `filename`, emitted so that both strict and
   * naive receivers get something usable.
   *
   * A quoted string may only hold ASCII (RFC 5322 §2.2), and RFC 2047
   * encoded-words are not allowed inside one (RFC 2047 §5), so a name like
   * `relatório.csv` can be carried only by the RFC 2231 extended form. That
   * form is emitted alongside a transliterated plain parameter: receivers that
   * understand `filename*` prefer it and the rest fall back to the ASCII name
   * instead of a mangled or rejected header.
   */
  encodeHeaderParam(name: string, value: string): string {
    const clean = this.sanitizeHeaderValue(value);
    const plain = `${name}="${this.quoteHeaderParam(clean)}"`;

    if (!/[^\x20-\x7E]/.test(clean)) {
      return plain;
    }

    const ascii = clean.replace(/[^\x20-\x7E]/g, "_");
    const extended = encodeURIComponent(clean).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );

    return `${name}="${this.quoteHeaderParam(ascii)}"; ${name}*=UTF-8''${extended}`;
  }

  /**
   * Caller-supplied headers, cleaned for wire use. Returns undefined when
   * there is nothing to send so callers can omit the field entirely.
   */
  trySanitizeHeaders(
    headers: Record<string, string> | undefined,
  ): Record<string, string> | undefined {
    if (!headers) {
      return undefined;
    }

    const entries = Object.entries(headers)
      .map(
        ([name, value]) =>
          [this.sanitizeHeaderName(name), this.sanitizeHeaderValue(value)] as const,
      )
      .filter(([name]) => name !== "");

    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  /**
   * RFC 2047-encode a header value as UTF-8 base64 encoded-words
   * (`=?UTF-8?B?...?=`) when the text contains non-ASCII characters or is long
   * enough to warrant encoding. Pure ASCII values that fit on one line are
   * passed through unchanged (they are already valid RFC 5322 header text).
   *
   * Long inputs are split into several encoded-words separated by CRLF + WSP,
   * which is header folding as RFC 2047 §5 requires.
   */
  rfc2047EncodeHeader(value: string): string {
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

  buildRawMessage({
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
  }): string {
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    // Base64-encode the HTML body so we never emit 8-bit or long raw lines.
    const htmlBase64 = this.foldBase64(Buffer.from(html, "utf-8").toString("base64"));

    const lines = [
      `From: ${this.sanitizeHeaderValue(from)}`,
      `To: ${to.map((address) => this.sanitizeHeaderValue(address)).join(", ")}`,
      ...(replyTo ? [`Reply-To: ${this.sanitizeHeaderValue(replyTo)}`] : []),
      // Custom headers come before Subject so they're unambiguously in the
      // header block. Routed through the same helper the other gateways use,
      // so a name carrying a colon or leading space cannot misparse or fold
      // this header.
      ...Object.entries(this.trySanitizeHeaders(headers) ?? {}).map(
        ([name, value]) => `${name}: ${value}`,
      ),
      `Subject: ${this.rfc2047EncodeHeader(subject)}`,
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
        `Content-Type: ${this.sanitizeHeaderValue(attachment.contentType)}; ${this.encodeHeaderParam("name", attachment.filename)}`,
        `Content-Disposition: attachment; ${this.encodeHeaderParam("filename", attachment.filename)}`,
        `Content-Transfer-Encoding: base64`,
        ``,
        this.foldBase64(Buffer.from(attachment.content).toString("base64")),
      );
    }

    lines.push(`--${boundary}--`);

    return lines.join("\r\n");
  }

  private quoteHeaderParam(value: string): string {
    return this.sanitizeHeaderValue(value).replace(/(["\\])/g, "\\$1");
  }

  private foldBase64(encoded: string): string {
    const chunks: string[] = [];

    for (let index = 0; index < encoded.length; index += BASE64_LINE_LENGTH) {
      chunks.push(encoded.slice(index, index + BASE64_LINE_LENGTH));
    }

    return chunks.join("\r\n");
  }
}
