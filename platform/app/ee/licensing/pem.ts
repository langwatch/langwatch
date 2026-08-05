/**
 * PEM normalization for license signing keys.
 *
 * OpenSSL's PEM reader is unforgiving about layout: it wants `-----BEGIN X-----`
 * at the start of a line and the base64 body on its own lines. A key that has
 * been through a copy/paste — a chat message, a code block, a YAML value, a
 * `.env` one-liner — arrives indented, space-prefixed or with its newlines
 * collapsed, and signing fails with an opaque `ERR_OSSL_UNSUPPORTED`.
 *
 * Only the base64 payload carries meaning, so we re-emit the block in canonical
 * form and let the layout of the paste be irrelevant.
 */

/** Matches a PEM block, capturing the label (`PRIVATE KEY`, `RSA PRIVATE KEY`, …) and its body. */
const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+?)-----([\s\S]*?)-----END \1-----/;

/**
 * The same, restricted to a private-key block (`PRIVATE KEY`, `RSA PRIVATE
 * KEY`, `EC PRIVATE KEY`, `ENCRYPTED PRIVATE KEY`).
 *
 * Preferred over the first block in the input, because a PEM file is legally a
 * *bundle*: operators keep a certificate or the public half in the same file,
 * often ahead of the private key. OpenSSL scans a bundle for the key it needs
 * and signs happily; canonicalizing whichever block came first would hand it
 * the certificate alone and break a key that worked before.
 */
const PEM_PRIVATE_KEY_BLOCK =
  /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/;

/** RFC 1421 headers (`Proc-Type:`, `DEK-Info:`) precede the body of legacy encrypted keys. */
const PEM_HEADER_LINE = /^[A-Za-z][A-Za-z0-9-]*:\s/m;

/** RFC 7468 wraps the base64 body at 64 characters. */
const PEM_BODY_LINE = /.{1,64}/g;

/**
 * Rewrites a PEM key into canonical form: no leading/trailing whitespace, no
 * indentation, body wrapped at 64 characters, LF line endings.
 *
 * Whitespace-insensitive by construction — the base64 body is stripped of all
 * whitespace and re-wrapped, so an indented, single-line or `\n`-escaped key
 * normalizes to exactly the same output as a pristine one. Idempotent, and a
 * canonical key passes through byte-identical.
 *
 * Two inputs are only dedented, never re-wrapped, because their line structure
 * is load-bearing: keys carrying RFC 1421 headers, and anything without a
 * recognizable PEM block (where the caller should see OpenSSL's own error
 * rather than one caused by us rewriting the input).
 */
export function normalizePemKey(raw: string): string {
  // A `.env` or JSON-sourced key arrives with literal backslash-n instead of
  // newlines; base64 and the PEM delimiters never contain a backslash, so this
  // is unambiguous.
  const unescaped = raw.replace(/^﻿/, "").replace(/\\r\\n|\\n/g, "\n");

  // The private-key block first: in a bundle it is the only block that can
  // sign, and it is not necessarily the one at the top of the file.
  const match =
    PEM_PRIVATE_KEY_BLOCK.exec(unescaped) ?? PEM_BLOCK.exec(unescaped);
  if (!match) {
    return dedent(unescaped);
  }

  const [, label, body = ""] = match;
  // Dedent before looking for headers: an indented paste puts whitespace where
  // the anchor expects a line start, and a missed header block would then be
  // folded into the base64 body — the one input this function must not rewrite.
  if (PEM_HEADER_LINE.test(dedent(body))) {
    return dedent(unescaped);
  }

  const base64 = body.replace(/\s+/g, "");
  const lines = base64.match(PEM_BODY_LINE) ?? [];

  return [
    `-----BEGIN ${label!}-----`,
    ...lines,
    `-----END ${label!}-----`,
    "",
  ].join("\n");
}

/**
 * Strips per-line indentation and trailing whitespace without touching line
 * structure, so a blank separator line survives.
 */
function dedent(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/** True when the key is passphrase-protected — signing cannot use it without the passphrase. */
export function isEncryptedPemKey(raw: string): boolean {
  const normalized = normalizePemKey(raw);
  return (
    normalized.includes("-----BEGIN ENCRYPTED PRIVATE KEY-----") ||
    PEM_HEADER_LINE.test(normalized)
  );
}

/** True when the input contains a PEM block at all — tells "not a key" apart from "bad key". */
export function looksLikePemKey(raw: string): boolean {
  return PEM_BLOCK.test(normalizePemKey(raw));
}
