import { formatPiiMarker } from "@langwatch/redaction";
import { findPhoneNumbersInText } from "libphonenumber-js";

/**
 * Native, lightweight redaction for the "essential" PII level: the pattern- and
 * checksum-based identifiers (emails, phones, cards, IPs, IBANs, national IDs)
 * that make up the overwhelming majority of PII in traces. Runs in-process per
 * span, so projects on the default essential level stop calling the external
 * analysis service. Person names and locations are intentionally NOT covered
 * here: they need ML NER and remain the "strict" level, which keeps the service.
 *
 * Flow mirrors Presidio analyze -> anonymize: collect candidate spans from every
 * recognizer, drop any that fail their checksum, gate low-confidence patterns on
 * a nearby context word, merge overlapping spans preferring the longer, then
 * rebuild the string in one pass replacing each survivor with its typed marker
 * (`[EMAIL_ADDRESS]`, `[PHONE_NUMBER]`, ...).
 *
 * Machine identifiers are held out of that: an attribute value that is
 * exclusively one identifier-shaped token runs only the self-proving
 * recognizers, and a phone number inside a longer token that carries letters is
 * dropped wherever it appears.
 */

const MAX_SCAN_LENGTH = 250_000;
const CONTEXT_WINDOW = 50;

export const ESSENTIAL_PII_ENTITIES = [
  "EMAIL_ADDRESS",
  "IP_ADDRESS",
  "CREDIT_CARD",
  "IBAN_CODE",
  "CRYPTO",
  "PHONE_NUMBER",
  "US_SSN",
  "US_ITIN",
  "US_PASSPORT",
  "US_BANK_NUMBER",
  "US_DRIVER_LICENSE",
  "MEDICAL_LICENSE",
  "UK_NHS",
  "SG_NRIC_FIN",
  "AU_ABN",
  "AU_TFN",
  "IN_PAN",
  "IN_AADHAAR",
  "BR_CPF",
] as const;

interface Recognizer {
  entity: string;
  regex: RegExp;
  /**
   * A literal the regex cannot match without, checked with `String.includes`
   * before the regex is run at all.
   *
   * These patterns are unanchored and scanned with `matchAll`, so on text that
   * cannot match they still cost a pass per starting position — the email
   * pattern alone measured 2.6% of the worker's wall time in production,
   * because `[A-Za-z0-9._%+-]+` consumes a long alphanumeric run, fails to
   * find `@`, and backs off a character at a time. `includes` is a native
   * substring scan and settles the same question in one pass.
   *
   * Only set this where the literal appears in the pattern itself, so the
   * claim is readable next to the regex rather than remembered. Getting it
   * wrong silently stops redacting real personal data, which is why
   * `essentialPii.prefilter.unit.test.ts` proves each one against its own
   * pattern rather than trusting the annotation.
   */
  requiresSubstring?: string;
  /** Checksum/structure check on the raw match; a falsey result drops the candidate. */
  validate?: (raw: string) => boolean;
  /** Low-confidence patterns only fire when one of these words is within the window. */
  contextRequired?: boolean;
  contextWords?: string[];
  /**
   * The match carries its own proof: a checksum, or a marker no machine
   * identifier holds by accident. Only these recognizers keep running on a
   * value that is exclusively one identifier-shaped token
   * (see {@link isIdentifierShapedValue}).
   */
  isSelfProving?: boolean;
}

function luhnValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
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

function ibanValid(raw: string): boolean {
  const compact = raw.replace(/\s/g, "").toUpperCase();
  if (compact.length < 15 || compact.length > 34) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const value = code >= 65 && code <= 90 ? (code - 55).toString() : ch; // A-Z -> 10..35
    for (const digitChar of value) {
      remainder = (remainder * 10 + (digitChar.charCodeAt(0) - 48)) % 97;
    }
  }
  return remainder === 1;
}

function ipv6Plausible(raw: string): boolean {
  if (raw.includes("::")) return true;
  if (/[a-fA-F]/.test(raw)) return true;
  return raw.split(":").length === 8;
}

/**
 * Validate a Brazilian CPF by its two check digits (mod 11). Rejects the
 * repeated-digit sequences (000.000.000-00, 111..., etc.) that pass the
 * arithmetic but are never issued, so a random eleven-digit run is not
 * mistaken for a taxpayer id.
 */
function cpfValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  const checkDigit = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += (digits.charCodeAt(i) - 48) * (length + 1 - i);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return (
    checkDigit(9) === digits.charCodeAt(9) - 48 &&
    checkDigit(10) === digits.charCodeAt(10) - 48
  );
}

const RECOGNIZERS: Recognizer[] = [
  {
    entity: "EMAIL_ADDRESS",
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    requiresSubstring: "@",
    isSelfProving: true,
  },
  {
    entity: "IP_ADDRESS",
    regex:
      /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g,
  },
  {
    entity: "IP_ADDRESS",
    regex: /\b(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}\b/g,
    requiresSubstring: ":",
    validate: ipv6Plausible,
  },
  {
    entity: "CREDIT_CARD",
    regex: /\b\d(?:[ -]?\d){12,18}\b/g,
    validate: luhnValid,
    isSelfProving: true,
  },
  {
    entity: "IBAN_CODE",
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    validate: ibanValid,
    isSelfProving: true,
  },
  {
    entity: "CRYPTO",
    regex: /\b0x[a-fA-F0-9]{40}\b/g,
    requiresSubstring: "0x",
    isSelfProving: true,
  },
  {
    entity: "CRYPTO",
    regex: /\b(?:bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g,
    isSelfProving: true,
  },
  // Hyphenated US SSN is distinctive enough to fire without context.
  { entity: "US_SSN", regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  // A bare nine-digit run is ambiguous (SSN / bank / passport); require context.
  {
    entity: "US_SSN",
    regex: /\b\d{9}\b/g,
    contextRequired: true,
    contextWords: ["ssn", "social security", "social", "taxpayer"],
  },
  {
    entity: "US_ITIN",
    regex: /\b9\d{2}[- ]?\d{2}[- ]?\d{4}\b/g,
    contextRequired: true,
    contextWords: ["itin", "taxpayer", "individual taxpayer"],
  },
  {
    entity: "US_PASSPORT",
    regex: /\b[A-Z0-9]\d{8}\b/g,
    contextRequired: true,
    contextWords: ["passport"],
  },
  {
    entity: "US_BANK_NUMBER",
    regex: /\b\d{8,17}\b/g,
    contextRequired: true,
    contextWords: [
      "account number",
      "account #",
      "routing",
      "bank account",
      "iban",
    ],
  },
  {
    entity: "US_DRIVER_LICENSE",
    regex: /\b[A-Z]\d{6,8}\b/g,
    contextRequired: true,
    contextWords: ["driver", "license", "licence", "dl number"],
  },
  {
    entity: "MEDICAL_LICENSE",
    regex: /\b[A-Za-z]{2}\d{7}\b/g,
    contextRequired: true,
    contextWords: ["dea", "medical license", "medical licence", "license"],
  },
  {
    entity: "UK_NHS",
    regex: /\b\d{3}[ -]?\d{3}[ -]?\d{4}\b/g,
    contextRequired: true,
    contextWords: ["nhs"],
  },
  {
    entity: "SG_NRIC_FIN",
    regex: /\b[STFGM]\d{7}[A-Z]\b/g,
    contextRequired: true,
    contextWords: ["nric", "fin", "singapore"],
  },
  {
    entity: "AU_ABN",
    regex: /\b\d{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{3}\b/g,
    contextRequired: true,
    contextWords: ["abn", "australian business number"],
  },
  {
    entity: "AU_TFN",
    regex: /\b\d{3}[ ]?\d{3}[ ]?\d{3}\b/g,
    contextRequired: true,
    contextWords: ["tfn", "tax file number"],
  },
  // Indian PAN has a fixed, distinctive shape.
  { entity: "IN_PAN", regex: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  {
    entity: "IN_AADHAAR",
    regex: /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g,
    contextRequired: true,
    contextWords: ["aadhaar", "aadhar", "uidai"],
  },
  // Brazilian CPF: 11 digits, written `123.456.789-09` or bare. The two check
  // digits make it self-validating, so it fires on the checksum alone.
  {
    entity: "BR_CPF",
    regex: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
    validate: cpfValid,
    isSelfProving: true,
  },
];

interface Span {
  start: number;
  end: number;
  /** The PII entity that matched here, written as the redaction marker. */
  entity: string;
}

const HAS_WHITESPACE = /\s/;
const HAS_LETTER = /[A-Za-z]/;
const HAS_DIGIT = /\d/;
const HAS_LOWERCASE = /[a-z]/;
const HAS_UPPERCASE = /[A-Z]/;
const UUID_VALUE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RUN_VALUE = /^[0-9a-f]{16,}$/i;
const BASE64ISH_VALUE = /^[A-Za-z0-9+/_=-]{16,}$/;

/**
 * The characters an identifier is written with: letters, digits, and the
 * separators ids use. A quote, a brace, a comma or a slash means the text is
 * structure that HOLDS values rather than one identifier, so minified JSON and
 * URLs stay fully scanned.
 */
const IDENTIFIER_VALUE = /^[A-Za-z0-9._:-]+$/;

/**
 * The characters that carry on an identifier around a detected span. Narrower
 * than {@link IDENTIFIER_VALUE}: a dot or a colon ends the token here, so
 * sentence punctuation and `"phone":"+1..."` in minified JSON cannot pull a
 * detected number into an identifier that surrounds it.
 */
const IDENTIFIER_TOKEN_CHAR = /[A-Za-z0-9_-]/;

/**
 * How far the identifier rules read. Identifiers people send as references are
 * far shorter, and the cap keeps both checks flat in the ingestion path however
 * long the text is.
 */
const MAX_IDENTIFIER_LENGTH = 256;

/**
 * Whether a whole attribute value is exclusively one identifier-shaped token:
 * letters together with digits and identifier separators
 * (`hosted-eu-20260812-09`), or the shape of a uuid, a hex digest, or a
 * base64-style token.
 *
 * The letter requirement is what keeps personal data in scope. A value built
 * only from digits and separators (`+31 6 12345678`, `20260812-09`, a bare card
 * number) is never identifier-shaped here, however much a customer means it as
 * a reference.
 */
function isIdentifierShapedValue(value: string): boolean {
  if (value.length > MAX_IDENTIFIER_LENGTH || !HAS_LETTER.test(value)) {
    return false;
  }
  if (HAS_DIGIT.test(value) && IDENTIFIER_VALUE.test(value)) return true;
  if (UUID_VALUE.test(value) || HEX_RUN_VALUE.test(value)) return true;
  return (
    BASE64ISH_VALUE.test(value) &&
    HAS_LOWERCASE.test(value) &&
    HAS_UPPERCASE.test(value)
  );
}

/**
 * Whether a match sits inside a longer identifier: the identifier characters
 * around it reach past the match and carry a letter, as the `20260812-09` in
 * `hosted-eu-20260812-09` does. A match that itself holds whitespace
 * (`+31 6 12345678`) covers more than one token, so it is never inside one.
 */
function insideIdentifierToken(text: string, span: Span): boolean {
  if (HAS_WHITESPACE.test(text.slice(span.start, span.end))) return false;
  const floor = Math.max(0, span.start - MAX_IDENTIFIER_LENGTH);
  let start = span.start;
  while (start > floor && IDENTIFIER_TOKEN_CHAR.test(text[start - 1]!)) start--;
  const ceiling = Math.min(text.length, span.end + MAX_IDENTIFIER_LENGTH);
  let end = span.end;
  while (end < ceiling && IDENTIFIER_TOKEN_CHAR.test(text[end]!)) end++;
  if (start === span.start && end === span.end) return false;
  return HAS_LETTER.test(text.slice(start, end));
}

function hasContextWord(
  text: string,
  span: Span,
  words: readonly string[],
): boolean {
  const before = text.slice(
    Math.max(0, span.start - CONTEXT_WINDOW),
    span.start,
  );
  const after = text.slice(span.end, span.end + CONTEXT_WINDOW);
  const window = (before + " " + after).toLowerCase();
  return words.some((word) => window.includes(word));
}

export interface PiiRedactionResult {
  text: string;
  redactedCount: number;
}

/**
 * Whether a detected span is vetoed by a do-not-redact exception: one of the
 * compiled exception regexes matches its ENTIRE matched text. Full-match only,
 * so an exception for a known-safe prefix can never carve a hole out of a
 * longer identifier it happens to start. Callers pre-anchor the patterns via
 * `compilePiiExceptPatterns`.
 */
export function matchesPiiException(
  matchedText: string,
  exceptPatterns: readonly RegExp[],
): boolean {
  return exceptPatterns.some((pattern) => pattern.test(matchedText));
}

/**
 * Compile policy exception patterns for the redaction passes, anchoring each
 * one so it must cover a detected span's whole matched text. Invalid patterns
 * are skipped defensively: the service layer rejects them at save time, so a
 * compile failure here means legacy or hand-edited config, and redaction must
 * keep running rather than crash ingestion.
 */
export function compilePiiExceptPatterns(
  patterns: readonly string[],
): RegExp[] {
  const compiled: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(`^(?:${pattern})$`));
    } catch {
      // Skip: validated at write time; never let a bad pattern break ingestion.
    }
  }
  return compiled;
}

/** A [start, end) character range an exception has vetoed from masking. */
export interface ProtectedRange {
  start: number;
  end: number;
}

/**
 * Subtract `protectedRanges` from one [start, end) interval, returning the
 * sub-intervals that remain maskable. Detected spans can overlap an
 * exception-vetoed span (DLP and the native recognizers both produce
 * overlapping findings on digit runs); masking must never eat into the vetoed
 * text, and must still cover whatever falls outside it.
 */
export function subtractProtectedRanges(
  span: { start: number; end: number },
  protectedRanges: readonly ProtectedRange[],
): { start: number; end: number }[] {
  const overlapping = protectedRanges
    .filter((range) => range.start < span.end && range.end > span.start)
    .sort((a, b) => a.start - b.start);
  if (overlapping.length === 0) return [{ start: span.start, end: span.end }];

  const result: { start: number; end: number }[] = [];
  let cursor = span.start;
  for (const range of overlapping) {
    if (range.start > cursor) {
      result.push({ start: cursor, end: Math.min(range.start, span.end) });
    }
    cursor = Math.max(cursor, range.end);
    if (cursor >= span.end) break;
  }
  if (cursor < span.end) result.push({ start: cursor, end: span.end });
  return result;
}

/**
 * Whether a raw recognizer match survives its own recognizer's rules: the
 * checksum/format validator (if any) and the nearby-context-word requirement
 * (if any). Does not apply the exception veto — that is shared across
 * recognizer types, see `excepted` in `collectCandidateSpans`.
 */
function isValidRecognizerMatch({
  recognizer,
  raw,
  span,
  text,
}: {
  recognizer: Recognizer;
  raw: string;
  span: Span;
  text: string;
}): boolean {
  if (recognizer.validate && !recognizer.validate(raw)) return false;
  if (
    recognizer.contextRequired &&
    !hasContextWord(text, span, recognizer.contextWords ?? [])
  ) {
    return false;
  }
  return true;
}

/**
 * One regex match reduced to a kept span, or null when the validator, the
 * context gate, or the exception veto rules it out. Split out of
 * `collectRecognizerSpans` so its loop body is a single call, not three
 * nested conditionals per match.
 */
function recognizedSpanFor({
  recognizer,
  match,
  text,
  excepted,
}: {
  recognizer: Recognizer;
  match: RegExpMatchArray;
  text: string;
  excepted: (span: Span) => boolean;
}): Span | null {
  const raw = match[0];
  const start = match.index ?? 0;
  const span: Span = {
    start,
    end: start + raw.length,
    entity: recognizer.entity,
  };
  if (!isValidRecognizerMatch({ recognizer, raw, span, text })) return null;
  if (excepted(span)) return null;
  return span;
}

/**
 * Whether one recognizer runs in this pass: the custom level can narrow the
 * set through `allowed`, and on an identifier-shaped value only the recognizers
 * that prove their own finding run. That value is one token a customer sends as
 * a reference, so a shape, or a word inside that same token, is not evidence of
 * personal data.
 */
function recognizerRuns({
  recognizer,
  allowed,
  isIdentifierShaped,
  text,
}: {
  recognizer: Recognizer;
  allowed: ReadonlySet<string> | null;
  isIdentifierShaped: boolean;
  text: string;
}): boolean {
  if (allowed && !allowed.has(recognizer.entity)) return false;
  // A pattern that cannot match without a literal is skipped on text that
  // does not contain it. This only ever removes a scan that would have found
  // nothing, so it cannot change which spans are redacted — provided the
  // literal really is required, which is what `requiresSubstring` documents
  // and its tests hold to.
  if (
    recognizer.requiresSubstring !== undefined &&
    !text.includes(recognizer.requiresSubstring)
  ) {
    return false;
  }
  return !isIdentifierShaped || recognizer.isSelfProving === true;
}

/**
 * Regex/checksum recognizer pass: every `RECOGNIZERS` entry `recognizerRuns`
 * keeps, reduced match-by-match via `recognizedSpanFor`. Split out of
 * `collectCandidateSpans` so each pass stays independently under the
 * cognitive-complexity budget.
 */
function collectRecognizerSpans({
  text,
  allowed,
  excepted,
  isIdentifierShaped,
}: {
  text: string;
  allowed: ReadonlySet<string> | null;
  excepted: (span: Span) => boolean;
  isIdentifierShaped: boolean;
}): Span[] {
  const spans: Span[] = [];
  for (const recognizer of RECOGNIZERS) {
    if (!recognizerRuns({ recognizer, allowed, isIdentifierShaped, text })) {
      continue;
    }
    for (const match of text.matchAll(recognizer.regex)) {
      const span = recognizedSpanFor({ recognizer, match, text, excepted });
      if (span) spans.push(span);
    }
  }
  return spans;
}

/**
 * Phone-number pass via libphonenumber-js, with the same exception veto as
 * the regex recognizers. Kept separate from `collectRecognizerSpans`: it is a
 * different library and match shape (`startsAt`/`endsAt`, not a regex match),
 * not a different set of rules.
 *
 * The detector has no checksum and no context word to prove a finding: any
 * digit run that parses as a dialable number matches. Two rules hold it to
 * digits a customer wrote as a number. It never runs on an identifier-shaped
 * value, and a match inside a longer token that carries letters is dropped.
 */
function collectPhoneSpans({
  text,
  allowed,
  excepted,
  isIdentifierShaped,
}: {
  text: string;
  allowed: ReadonlySet<string> | null;
  excepted: (span: Span) => boolean;
  isIdentifierShaped: boolean;
}): Span[] {
  if (isIdentifierShaped) return [];
  if (allowed && !allowed.has("PHONE_NUMBER")) return [];
  const spans: Span[] = [];
  try {
    for (const phone of findPhoneNumbersInText(text, {
      defaultCountry: "US",
    })) {
      const span: Span = {
        start: phone.startsAt,
        end: phone.endsAt,
        entity: "PHONE_NUMBER",
      };
      if (insideIdentifierToken(text, span)) continue;
      if (excepted(span)) continue;
      spans.push(span);
    }
  } catch {
    // Defensive: never let phone parsing break ingestion.
  }
  return spans;
}

/**
 * Collect every candidate PII span in `text`: the regex/checksum recognizers
 * (respecting `allowed`) plus the phone detector, running each candidate
 * through its validator/context gate and the exception veto. Vetoed spans are
 * appended to `protectedRanges` as a side effect so the caller can shield them
 * from later overlapping, non-excepted spans.
 */
function collectCandidateSpans({
  text,
  allowed,
  exceptPatterns,
  protectedRanges,
  isIdentifierShaped,
}: {
  text: string;
  allowed: ReadonlySet<string> | null;
  exceptPatterns: readonly RegExp[] | undefined;
  protectedRanges: ProtectedRange[];
  isIdentifierShaped: boolean;
}): Span[] {
  const excepted = (span: Span): boolean => {
    const veto =
      !!exceptPatterns &&
      exceptPatterns.length > 0 &&
      matchesPiiException(text.slice(span.start, span.end), exceptPatterns);
    if (veto) protectedRanges.push({ start: span.start, end: span.end });
    return veto;
  };

  return [
    ...collectRecognizerSpans({ text, allowed, excepted, isIdentifierShaped }),
    ...collectPhoneSpans({ text, allowed, excepted, isIdentifierShaped }),
  ];
}

/**
 * Rebuild `text` with every maskable span replaced by its typed marker.
 * `spans` must already be exception-shielded (see `collectCandidateSpans`) and
 * merged for overlaps; a kept span can still overlap a protected one (a phone
 * match inside an excepted number), so each is further split against
 * `protectedRanges` before masking, so an exception always preserves its
 * entire matched text.
 */
function maskSpans({
  text,
  spans,
  protectedRanges,
}: {
  text: string;
  spans: readonly Span[];
  protectedRanges: readonly ProtectedRange[];
}): PiiRedactionResult {
  const maskable = spans.flatMap((span) =>
    subtractProtectedRanges(span, protectedRanges).map((part) => ({
      ...part,
      entity: span.entity,
    })),
  );
  if (maskable.length === 0) return { text, redactedCount: 0 };

  let result = "";
  let cursor = 0;
  for (const span of maskable) {
    result += text.slice(cursor, span.start) + formatPiiMarker(span.entity);
    cursor = span.end;
  }
  result += text.slice(cursor);

  return { text: result, redactedCount: maskable.length };
}

/**
 * Redact essential PII from one string and report how many spans were replaced.
 *
 * `entities` narrows the recognizers that run: pass a subset (the custom PII
 * level) to redact only those identifiers, or omit it (the essential level) to
 * run every native recognizer. Entity names are the canonical identifiers from
 * `ESSENTIAL_PII_ENTITIES` (e.g. `EMAIL_ADDRESS`, `BR_CPF`).
 *
 * `exceptPatterns` are the policy's do-not-redact exceptions (pre-anchored via
 * `compilePiiExceptPatterns`): a detected span whose entire matched text
 * matches one of them is left as it was.
 *
 * `isAttributeValue` says the text is one attribute value rather than free
 * text. A value that is exclusively one identifier-shaped token then runs only
 * the self-proving recognizers, because customers send identifiers on purpose
 * and a shape alone does not make one personal data. Free text never takes the
 * exemption: a document with no spaces in it is still a document.
 */
export function redactEssentialPiiInText({
  text,
  entities,
  exceptPatterns,
  isAttributeValue = false,
}: {
  text: string;
  entities?: readonly string[];
  exceptPatterns?: readonly RegExp[];
  isAttributeValue?: boolean;
}): PiiRedactionResult {
  if (
    typeof text !== "string" ||
    text.length === 0 ||
    text.length > MAX_SCAN_LENGTH
  ) {
    return { text, redactedCount: 0 };
  }

  const protectedRanges: ProtectedRange[] = [];
  const spans = collectCandidateSpans({
    text,
    allowed: entities ? new Set(entities) : null,
    exceptPatterns,
    protectedRanges,
    isIdentifierShaped: isAttributeValue && isIdentifierShapedValue(text),
  });
  if (spans.length === 0) return { text, redactedCount: 0 };

  // Merge overlaps, preferring earlier-and-longer spans.
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Span[] = [];
  let lastEnd = -1;
  for (const span of spans) {
    if (span.start >= lastEnd) {
      kept.push(span);
      lastEnd = span.end;
    }
  }

  return maskSpans({ text, spans: kept, protectedRanges });
}
