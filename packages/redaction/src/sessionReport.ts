/**
 * Session-report scrubbing: prepares a coding-agent session transcript (or a
 * free-form summary) for sending to the LangWatch team as an issue report.
 *
 * Everything here runs locally, before anything leaves the machine. Three
 * passes, strongest first:
 *
 *  1. Environment literals: the exact values of environment variables whose
 *     names look sensitive (keys, tokens, secrets, passwords) are removed
 *     wherever they appear, regardless of shape.
 *  2. Credential patterns: the same secret rules the LangWatch platform runs
 *     at ingestion (see `secrets.ts`): provider API keys (sk-...), AWS and
 *     Google keys, GitHub / Slack / Stripe tokens, JWTs, private-key blocks,
 *     connection-URL passwords, bearer tokens. JSON keys with sensitive names
 *     (password, api_key, authorization, cookie, ...) have their whole value
 *     scrubbed.
 *  3. Basic PII patterns: email addresses, phone numbers (international
 *     `+`-prefixed or punctuated formats), credit card numbers (Luhn-checked),
 *     public IPv4 addresses. Loopback, private-range, and link-local addresses
 *     are kept: they identify nobody and are essential to debug local setups.
 *     IPv6 is not scanned, so an IPv6 address is sent as written.
 *
 * Deliberate limits, so reports stay debuggable:
 *  - Bare unformatted digit runs only count as card numbers at lengths 14-16;
 *    a 13-digit run is far more often a millisecond timestamp and a 19-digit
 *    run a nanosecond timestamp than a card.
 *  - Phone numbers without a `+` prefix are only matched in punctuated forms
 *    like (415) 555-2671 or 415-555-2671, never as bare digit runs.
 *  - IPv6 is not scanned; public IPv6 addresses are rare in agent sessions
 *    and the pattern is too noisy against base64 and hex ids.
 *
 * This module is mirrored verbatim into the `langwatch` CLI
 * (`sdks/typescript/src/internal/generated/redaction/`), so this file is the
 * exact code that runs before a report is sent. A drift test pins the mirror
 * byte-for-byte.
 */
import { formatPiiMarker, SECRET_MARKER } from "./markers.js";
import { isSensitiveAttributeKey, redactSecretsInText } from "./secrets.js";

const EMAIL_MARKER = formatPiiMarker("EMAIL_ADDRESS");
const PHONE_MARKER = formatPiiMarker("PHONE_NUMBER");
const CARD_MARKER = formatPiiMarker("CREDIT_CARD");
const IP_MARKER = formatPiiMarker("IP_ADDRESS");

/**
 * Env-var NAMES that hold secrets. Broader than the platform's attribute-key
 * rule on purpose: attribute keys must not match telemetry names like
 * `gen_ai.usage.input_tokens`, but env names are short and structured, so
 * bare `KEY` and `TOKEN` segments are safe to treat as sensitive
 * (GITHUB_TOKEN, AWS_SECRET_ACCESS_KEY, SSH_KEY, NPM_TOKEN, ...).
 */
const ENV_SECRET_NAME_REGEX =
  /(?:^|[._-])(?:key|token|secret|password|passwd|pwd|credentials?|auth)(?:$|[._-])/i;

/** Values shorter than this are never treated as env secrets ("1", "true", ports). */
const MIN_ENV_SECRET_LENGTH = 8;

/**
 * The exact values of sensitive-looking environment variables, longest first
 * so overlapping values scrub fully. Matching is literal (split/join), so it
 * works on any shape a key takes, including ones no pattern knows about.
 */
export function collectSensitiveEnvValues(
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const values = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    const trimmed = value.trim();
    if (trimmed.length < MIN_ENV_SECRET_LENGTH) continue;
    if (!ENV_SECRET_NAME_REGEX.test(name)) continue;
    values.add(trimmed);
  }
  return [...values].sort((a, b) => b.length - a.length);
}

// Quantifiers bounded to the RFC limits (64-char local part, 253-char domain)
// so a long run of name-like characters costs constant backtracking per
// position instead of a quadratic scan on huge transcript strings.
const EMAIL_REGEX =
  /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g;

/** International phone candidates: `+` then 7-15 digits with light punctuation. */
const INTL_PHONE_REGEX =
  /(?<![\w.+-])\+[1-9]\d{0,2}(?:[\s.-]?(?:\(\d{1,4}\)[\s.-]?)?\d{1,4}){1,5}(?!\d)/g;

/** Punctuated national formats: (415) 555-2671, 415-555-2671, 415.555.2671. */
const NATIONAL_PHONE_REGEX =
  /(?<!\d)(?:\(\d{3}\)[\s.-]?|\d{3}[.-])\d{3}[.-]\d{4}(?!\d)/g;

/** Card candidates: 13-19 digits, optionally separated by spaces or dashes. */
const CARD_REGEX = /(?<![\d.-])\d(?:[ -]?\d){12,18}(?![\d.-])/g;

const IPV4_REGEX =
  /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g;

const countDigits = (value: string): number => value.replace(/\D/g, "").length;

/** Luhn checksum, the self-verification every real card number carries. */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function isCardNumber(candidate: string): boolean {
  const digits = candidate.replace(/[ -]/g, "");
  if (!/^\d+$/.test(digits)) return false;
  const separated = /[ -]/.test(candidate);
  // Bare runs only at common card lengths; separated runs at any card length.
  if (!separated && (digits.length < 14 || digits.length > 16)) return false;
  if (digits.length < 13 || digits.length > 19) return false;
  return passesLuhn(digits);
}

/** Loopback, RFC1918, link-local, CGNAT, and the zero/broadcast addresses. */
function isPrivateOrLocalIp(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  const [a = 0, b = 0] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

/**
 * `redactSecretsInText` passes very long inputs through untouched (its scan
 * budget protects the ingestion hot path). Session transcripts routinely carry
 * huge single strings, so here long text is redacted in slices below that
 * budget instead of skipped. Slices prefer newline boundaries so multi-line
 * patterns (PEM blocks) stay intact; a secret sitting exactly on a hard slice
 * boundary of a 200k+ single-line string is the accepted trade-off.
 */
const SLICE_TARGET = 200_000;

function sliceLongText(text: string): string[] {
  if (text.length <= SLICE_TARGET) return [text];
  const slices: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + SLICE_TARGET, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end);
      if (newline > start + SLICE_TARGET / 2) end = newline;
    }
    slices.push(text.slice(start, end));
    start = end;
  }
  return slices;
}

export interface SessionRedactionResult {
  text: string;
  redactedCount: number;
}

function redactPiiPatterns(text: string): SessionRedactionResult {
  let redactedCount = 0;
  let result = text.replace(EMAIL_REGEX, () => {
    redactedCount++;
    return EMAIL_MARKER;
  });
  result = result.replace(CARD_REGEX, (match) => {
    if (!isCardNumber(match)) return match;
    redactedCount++;
    return CARD_MARKER;
  });
  result = result.replace(INTL_PHONE_REGEX, (match) => {
    const digits = countDigits(match);
    if (digits < 7 || digits > 15) return match;
    redactedCount++;
    return PHONE_MARKER;
  });
  result = result.replace(NATIONAL_PHONE_REGEX, () => {
    redactedCount++;
    return PHONE_MARKER;
  });
  result = result.replace(IPV4_REGEX, (match) => {
    if (isPrivateOrLocalIp(match)) return match;
    redactedCount++;
    return IP_MARKER;
  });
  return { text: result, redactedCount };
}

function scrubEnvLiterals(
  text: string,
  envValues: readonly string[],
): SessionRedactionResult {
  let result = text;
  let redactedCount = 0;
  for (const value of envValues) {
    if (!result.includes(value)) continue;
    const parts = result.split(value);
    redactedCount += parts.length - 1;
    result = parts.join(SECRET_MARKER);
  }
  return { text: result, redactedCount };
}

/**
 * Redact one piece of free text with all three passes. `envValues` comes from
 * `collectSensitiveEnvValues` (precompute it once per report).
 */
export function redactReportText({
  text,
  envValues = [],
}: {
  text: string;
  envValues?: readonly string[];
}): SessionRedactionResult {
  if (typeof text !== "string" || text.length === 0) {
    return { text, redactedCount: 0 };
  }

  const envPass = scrubEnvLiterals(text, envValues);
  let redactedCount = envPass.redactedCount;

  const pieces = sliceLongText(envPass.text).map((slice) => {
    const secrets = redactSecretsInText({ text: slice });
    redactedCount += secrets.redactedCount;
    const pii = redactPiiPatterns(secrets.text);
    redactedCount += pii.redactedCount;
    return pii.text;
  });

  return { text: pieces.join(""), redactedCount };
}

function redactJsonValue(
  value: unknown,
  envValues: readonly string[],
  count: { redacted: number },
): unknown {
  if (typeof value === "string") {
    const result = redactReportText({ text: value, envValues });
    count.redacted += result.redactedCount;
    return result.text;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item, envValues, count));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (
        isSensitiveAttributeKey(key) &&
        entry !== null &&
        entry !== undefined
      ) {
        out[key] = SECRET_MARKER;
        count.redacted++;
        continue;
      }
      out[key] = redactJsonValue(entry, envValues, count);
    }
    return out;
  }
  return value;
}

/**
 * Redact a session transcript in JSONL form (one JSON document per line, the
 * format Claude Code and Codex write). Lines that parse as JSON are walked
 * structurally: sensitive keys have their whole value scrubbed and every
 * string is pattern-redacted. Lines that do not parse are redacted as text,
 * so nothing is skipped.
 */
export function redactSessionJsonl({
  jsonl,
  envValues = [],
}: {
  jsonl: string;
  envValues?: readonly string[];
}): SessionRedactionResult {
  let redactedCount = 0;
  const lines = jsonl.split("\n").map((line) => {
    if (line.trim().length === 0) return line;
    try {
      const parsed: unknown = JSON.parse(line);
      const count = { redacted: 0 };
      const redacted = redactJsonValue(parsed, envValues, count);
      redactedCount += count.redacted;
      return JSON.stringify(redacted);
    } catch {
      const result = redactReportText({ text: line, envValues });
      redactedCount += result.redactedCount;
      return result.text;
    }
  });
  return { text: lines.join("\n"), redactedCount };
}

export interface TruncationResult {
  text: string;
  truncated: boolean;
}

/**
 * Keep a transcript under a byte budget by dropping the OLDEST lines: the end
 * of a session is where the struggle and its resolution live.
 */
export function truncateJsonlToByteBudget({
  jsonl,
  maxBytes,
}: {
  jsonl: string;
  maxBytes: number;
}): TruncationResult {
  const encoder = new TextEncoder();
  if (encoder.encode(jsonl).length <= maxBytes) {
    return { text: jsonl, truncated: false };
  }
  const lines = jsonl.split("\n");
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    const size = encoder.encode(line).length + 1;
    if (used + size > maxBytes) break;
    kept.unshift(line);
    used += size;
  }
  return { text: kept.join("\n"), truncated: true };
}

/**
 * Where to audit this exact file on GitHub. The CLI prints this URL so agents
 * can read the rules that scrub their report before deciding to send it.
 */
export const REDACTION_AUDIT_URL =
  "https://github.com/langwatch/langwatch/blob/main/packages/redaction/src/sessionReport.ts";

/**
 * Human-readable summary of everything the session-report redaction removes.
 * Shown in the CLI help so agents know what is safe to send.
 */
export const SESSION_REDACTION_SUMMARY: readonly string[] = [
  "values of environment variables with key/token/secret/password-like names",
  "provider API keys (sk-... from OpenAI, Anthropic, LangWatch, and others)",
  "AWS access key ids, Google API keys, GitHub / Slack / Stripe tokens",
  "JWTs, bearer tokens, private-key blocks, passwords inside connection URLs",
  "JSON fields named like password, api_key, authorization, cookie, and similar",
  "email addresses, phone numbers, credit card numbers, public IPv4 addresses",
];
