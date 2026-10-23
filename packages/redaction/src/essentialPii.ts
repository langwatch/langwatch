import type { CountryCode } from "libphonenumber-js";
import { findPhoneNumbersInText } from "libphonenumber-js";
import { findPhoneNumbersInText as findPhoneNumbersInTextStrict } from "libphonenumber-js/max";

import { isBitcoinAddress } from "./bitcoinAddress.ts";
import { isIdentifierShapedValue, MAX_IDENTIFIER_LENGTH } from "./identifierHoldout.ts";
import { formatPiiMarker } from "./markers.ts";

/**
 * Native, lightweight redaction for the "essential" PII level (emails, phones, cards, IPs,
 * IBANs, national IDs), run in-process per span so projects on the default level stop calling
 * the external analysis service. Names and locations need ML NER and stay at "strict".
 */

const MAX_SCAN_LENGTH = 250_000;
const CONTEXT_WINDOW = 50;

export { ESSENTIAL_PII_ENTITIES } from "./piiEntities.ts";

interface Recognizer {
  entity: string;
  regex: RegExp;
  /**
   * A literal the regex cannot match without, checked via `String.includes` before the regex
   * runs to skip its backtracking cost on non-matching text. Getting it wrong silently stops
   * redacting real data, so `essentialPii.prefilter.unit.test.ts` proves each one.
   */
  requiresSubstring?: string;
  /** Checksum/structure check on the raw match; a falsey result drops the candidate. */
  validate?: (raw: string) => boolean;
  /** Low-confidence patterns only fire when one of these words is within the window. */
  contextRequired?: boolean;
  contextWords?: string[];
  /**
   * The match proves itself (checksum or unambiguous marker) — only then does a
   * recognizer keep running on an identifier-shaped value. Shape alone is not
   * proof: bitcoin and card once matched on shape and hit machine identifiers.
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

const UATP_LENGTH = 15;
const MASTERCARD_SERIES_FIRST = 2221;
const MASTERCARD_SERIES_LAST = 2720;
const MASTERCARD_SERIES_LENGTH = 16;

/**
 * Whether a card scheme could have issued this number AT THIS LENGTH: guards
 * against Unix-timestamp digit runs that pass Luhn (UATP and Mastercard's
 * 2-series are gated on length precisely to keep those collisions excluded).
 */
function issuedCardRange(digits: string): boolean {
  const first = digits.charCodeAt(0) - 48;
  if (first === 1) return digits.length === UATP_LENGTH;
  if (first === 2) {
    if (digits.length !== MASTERCARD_SERIES_LENGTH) return false;
    const series = Number(digits.slice(0, 4));
    return series >= MASTERCARD_SERIES_FIRST && series <= MASTERCARD_SERIES_LAST;
  }
  return true;
}

/**
 * Whether a digit run is a plausible payment card (length, issuer range, and
 * Luhn). Luhn alone is not proof — one random digit run in ten passes it — so
 * the issuer range is what makes CREDIT_CARD's self-proving flag honest.
 */
function creditCardValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  return issuedCardRange(digits) && luhnValid(raw);
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
 * Validates a Brazilian CPF by its two check digits (mod 11). Rejects repeated-digit
 * sequences (000.000.000-00, 111..., etc.) that pass the arithmetic but are never issued,
 * so a random eleven-digit run isn't mistaken for a taxpayer id.
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
    checkDigit(9) === digits.charCodeAt(9) - 48 && checkDigit(10) === digits.charCodeAt(10) - 48
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
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g,
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
    validate: creditCardValid,
    isSelfProving: true,
  },
  {
    entity: "IBAN_CODE",
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    validate: ibanValid,
    isSelfProving: true,
  },
  // An Ethereum address is the literal `0x` followed by exactly forty hex
  // characters. The prefix is the proof here: a trace id, a span id and a digest
  // are bare hex, so none of them carries it, and the `requiresSubstring` gate
  // means the pattern is not even scanned for on text without it.
  {
    entity: "CRYPTO",
    regex: /\b0x[a-fA-F0-9]{40}\b/g,
    requiresSubstring: "0x",
    isSelfProving: true,
  },
  // Bitcoin, legacy (`1…`/`3…`) and segwit (`bc1…`). The pattern alone is a
  // SHAPE that roughly one in sixty random hex strings fits (i.e. OTel trace
  // ids); `isBitcoinAddress` verifies the checksum so a match is proof, not a
  // guess. Segwit is written twice (not with an `i` flag) to keep the two
  // case-classes from mixing confusable glyphs base58 excludes.
  {
    entity: "CRYPTO",
    regex: /\b(?:bc1[a-z0-9]{25,62}|BC1[A-Z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g,
    validate: isBitcoinAddress,
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
    contextWords: ["account number", "account #", "routing", "bank account", "iban"],
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

/**
 * The characters that carry on an identifier around a detected span. Narrower than the
 * whole-value rule in {@link isIdentifierShapedValue}: a dot or colon ends the token here, so
 * sentence punctuation and `"phone":"+1..."` in minified JSON can't pull in a number.
 */
const IDENTIFIER_TOKEN_CHAR = /[A-Za-z0-9_-]/;

/**
 * Whether a match sits inside a longer identifier: the identifier characters around it reach
 * past the match and carry a letter, as `20260812-09` does in `hosted-eu-20260812-09`. A
 * match holding whitespace (`+31 6 12345678`) covers more than one token, so never inside one.
 */
function insideIdentifierToken(text: string, span: Span): boolean {
  const matchedText = text.slice(span.start, span.end);
  if (HAS_WHITESPACE.test(matchedText)) return false;
  const floor = Math.max(0, span.start - MAX_IDENTIFIER_LENGTH);
  let start = span.start;
  while (start > floor && IDENTIFIER_TOKEN_CHAR.test(text[start - 1]!)) start--;
  const ceiling = Math.min(text.length, span.end + MAX_IDENTIFIER_LENGTH);
  let end = span.end;
  while (end < ceiling && IDENTIFIER_TOKEN_CHAR.test(text[end]!)) end++;
  if (start === span.start && end === span.end) return false;
  return HAS_LETTER.test(text.slice(start, end));
}

function hasContextWord(text: string, span: Span, words: readonly string[]): boolean {
  const before = text.slice(Math.max(0, span.start - CONTEXT_WINDOW), span.start);
  const after = text.slice(span.end, span.end + CONTEXT_WINDOW);
  const window = (before + " " + after).toLowerCase();
  return words.some((word) => window.includes(word));
}

export interface PiiRedactionResult {
  text: string;
  redactedCount: number;
}

/**
 * Whether a detected span is vetoed by a do-not-redact exception: a compiled regex matches
 * its ENTIRE matched text. Full-match only, so an exception for a known-safe prefix can't
 * carve a hole out of a longer identifier it happens to start. Callers pre-anchor patterns.
 */
export function matchesPiiException(
  matchedText: string,
  exceptPatterns: readonly RegExp[],
): boolean {
  return exceptPatterns.some((pattern) => pattern.test(matchedText));
}

/**
 * Compiles policy exception patterns for the redaction passes, anchoring each one to cover a
 * detected span's whole matched text. Invalid patterns are skipped defensively — the service
 * layer rejects them at save time, so a failure here means stale config, not a crash to risk.
 */
export function compilePiiExceptPatterns(patterns: readonly string[]): RegExp[] {
  const compiled: RegExp[] = [];
  for (const pattern of patterns) {
    const anchored = findAnchoredPattern(pattern);
    if (anchored) compiled.push(anchored);
  }
  return compiled;
}

/**
 * One exception pattern, anchored, or undefined when it does not compile — the
 * service layer rejects those at save time, so an uncompilable one here is
 * stale config and is skipped rather than allowed to break ingestion.
 */
function findAnchoredPattern(pattern: string): RegExp | undefined {
  try {
    return new RegExp(`^(?:${pattern})$`);
  } catch {
    return void 0;
  }
}

/** A [start, end) character range an exception has vetoed from masking. */
export interface ProtectedRange {
  start: number;
  end: number;
}

/**
 * Subtracts `protectedRanges` from one [start, end) interval, returning the sub-intervals
 * that remain maskable. Detected spans can overlap an exception-vetoed span (DLP and native
 * recognizers both find overlapping digit runs); masking must never eat into vetoed text.
 */
export function subtractProtectedRanges(
  span: { start: number; end: number },
  protectedRanges: readonly ProtectedRange[],
): { start: number; end: number }[] {
  const overlapping = protectedRanges
    .filter((range) => range.start < span.end && range.end > span.start)
    .toSorted((a, b) => a.start - b.start);
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
 * Whether a raw recognizer match survives its own recognizer's rules: the checksum/format
 * validator (if any) and the nearby-context-word requirement (if any). Does not apply the
 * exception veto, shared across recognizer types — see `excepted` in `collectCandidateSpans`.
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
  if (recognizer.contextRequired && !hasContextWord(text, span, recognizer.contextWords ?? [])) {
    return false;
  }
  return true;
}

/**
 * One regex match reduced to a kept span, or null when the validator, context gate, or
 * exception veto rules it out. Split out of `collectRecognizerSpans` so its loop body is a
 * single call, not three nested conditionals per match.
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
 * Whether one recognizer runs in this pass: the custom level can narrow the set through
 * `allowed`, and on an identifier-shaped value only self-proving recognizers run — the value
 * is a token a customer sends as a reference, so a shape alone isn't evidence of personal data.
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
  if (recognizer.requiresSubstring !== undefined && !text.includes(recognizer.requiresSubstring)) {
    return false;
  }
  return !isIdentifierShaped || recognizer.isSelfProving === true;
}

/**
 * Regex/checksum recognizer pass: every `RECOGNIZERS` entry `recognizerRuns` keeps, reduced
 * match-by-match via `recognizedSpanFor`. Split out of `collectCandidateSpans` so each pass
 * stays independently under the cognitive-complexity budget.
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
 * Phone-number pass via libphonenumber-js, kept separate from
 * `collectRecognizerSpans` (different match shape). By far the most expensive
 * check here, so `ENOUGH_DIGITS_FOR_A_NUMBER` gates it before it ever runs.
 */

/**
 * Floor is 6, one below libphonenumber's shortest example number (7 digits);
 * up to 4 separators still count as one digit window (a superset of the
 * library's own allowance), so the gate only ever errs toward running the check.
 */
const ENOUGH_DIGITS_FOR_A_NUMBER = /\d(?:[^0-9A-Za-z]{0,4}\d){5}/;

/**
 * Regions tried for national-format numbers, which the US pass misreads. Europe first, then
 * the large English and Portuguese markets; order only decides which region claims a span.
 * `trunkZero`: the region writes every national number with a leading `0`.
 */
interface NationalRegion {
  region: CountryCode;
  trunkZero: boolean;
}

const NATIONAL_FORMAT_REGIONS: readonly NationalRegion[] = [
  { region: "GB", trunkZero: true },
  { region: "NL", trunkZero: true },
  { region: "DE", trunkZero: true },
  { region: "FR", trunkZero: true },
  { region: "BE", trunkZero: true },
  { region: "IE", trunkZero: true },
  { region: "AT", trunkZero: true },
  { region: "CH", trunkZero: true },
  { region: "AU", trunkZero: true },
  { region: "ES", trunkZero: false },
  { region: "PT", trunkZero: false },
  { region: "IT", trunkZero: false },
  { region: "IN", trunkZero: false },
  { region: "BR", trunkZero: false },
];

const TRUNK_ZERO_REGIONS = NATIONAL_FORMAT_REGIONS.filter(({ trunkZero }) => trunkZero);
const NO_TRUNK_REGIONS = NATIONAL_FORMAT_REGIONS.filter(({ trunkZero }) => !trunkZero);

/**
 * A digit run with phone separators, at most 26 characters. It never starts glued to a word,
 * `+` or `#`, inside a dotted, dashed or timed number (`2026-09-30`, `12:34:05`) or after a
 * path or id separator (`v/012`, `ab-012`).
 */
const NATIONAL_CANDIDATE = /(?<![\w+#]|\d[-./:,]|[A-Za-z_][-/])\(?\d[\d ()./-]{5,24}\d/g;
const TRUNK_ZERO_GROUP = /(?:^|[^\d.,])0[1-9]/;
const LEADS_WITH_TRUNK_ZERO = /^\(?0[1-9]/;
const LEADS_WITH_AREA_CODE = /^(?:\(?0[1-9]|\(\d{1,5}\))/;
const SPACED_GROUPS = /\d[ ()/-]+\d/;
const DOT = /\./g;
const CONTAINS_DATE = /\d{1,2}([./-])\d{1,2}\1\d{4}|\d{4}([./-])\d{1,2}\2\d{1,2}/;
const NATIONAL_DIGIT_FLOOR = 7;
/** The shortest mobile in the regions without a trunk zero (nine digits, ES and PT). */
const SHORTEST_NO_TRUNK_MOBILE = 9;
const LONGEST_UNGROUPED_NUMBER = 12;
const MOBILE_TYPES: ReadonlySet<string> = new Set(["MOBILE", "FIXED_LINE_OR_MOBILE"]);
/** Shapes trace text holds that parse as numbers: a code ending `-7`, a decimal, a column gap. */
const NOT_A_PHONE_SHAPE = /\D\d$| {3,}|\. |^[^.]*\.\d{1,2}$|^0\d{3}\.\d{3}\.\d{3}$|^\d{5}-\d{3}$/;
/** A word that says a phone number follows, in the major languages, or `T:` / `M:` right before. */
const PHONE_CUE =
  /(?:\b(?:tel|phone|fone|mobile?|mobiel|m[oó]vil|celular|cell|cellulare|whats ?app|telefo(?:on|n|no|ne)|t[eé]l[eé]phone|telem[oó]vel|handy|gsm|portable|fax|sms|call|ring|bel(?:len)?|ligue|llam[ae]|chiama|anruf\w*|appel\w*)|(?:^|[^A-Za-z])[MT]\s?[.:])/i;
const PHONE_CUE_WINDOW = 40;
/** A country code with or without check digits and a bank code: a grouped IBAN or a VAT number. */
const IBAN_OR_VAT_PREFIX = /\b[A-Z]{2}(?:\d{2} ?(?:[A-Z0-9]{4} ?){0,2})? ?$/;
const GLUED_AFTER = /^(?:[A-Za-z0-9]|[.,]\d)/;

/** Digit groups split by spaces, dashes, slashes or brackets, or by two dots or more. */
function isGrouped(raw: string): boolean {
  return SPACED_GROUPS.test(raw) || (raw.match(DOT)?.length ?? 0) >= 2;
}

/** Whether a raw match can be a national-format number at all, whatever its type. */
function isNationalShape(raw: string): boolean {
  if (raw.includes("+") || raw.startsWith("00")) return false;
  if (CONTAINS_DATE.test(raw) || NOT_A_PHONE_SHAPE.test(raw)) return false;
  return isGrouped(raw) || !hasDigitCount(raw, LONGEST_UNGROUPED_NUMBER + 1);
}

/**
 * Whether a number parsed in `trunkZero`'s region is written the way that region writes
 * phones: a trunk-zero region needs its leading `0`; elsewhere a mobile needs an area code in
 * front, or digit groups and a phone word nearby; a landline needs an area code and groups.
 */
function isNationalFormatPhone({
  raw,
  type,
  trunkZero,
  cued,
}: {
  raw: string;
  type: string | undefined;
  trunkZero: boolean;
  cued: () => boolean;
}): boolean {
  if (!isNationalShape(raw)) return false;
  if (trunkZero && !LEADS_WITH_TRUNK_ZERO.test(raw)) return false;
  const leadsWithAreaCode = LEADS_WITH_AREA_CODE.test(raw);
  if (type !== undefined && MOBILE_TYPES.has(type)) {
    return leadsWithAreaCode || (isGrouped(raw) && cued());
  }
  return type === "FIXED_LINE" && leadsWithAreaCode && isGrouped(raw);
}

/** Whether a phone word sits in the few characters before `start`. */
function hasPhoneCue(text: string, start: number): boolean {
  return PHONE_CUE.test(text.slice(Math.max(0, start - PHONE_CUE_WINDOW), start));
}

/**
 * Whether the text around a national-format match shows it is part of something else: glued
 * to a letter, a digit or a decimal after it, or the digits of a grouped IBAN or a VAT number.
 */
function isPartOfLongerValue(text: string, span: Span): boolean {
  if (GLUED_AFTER.test(text.slice(span.end, span.end + 2))) return true;
  return IBAN_OR_VAT_PREFIX.test(text.slice(Math.max(0, span.start - 12), span.start));
}

/** Counts digits in `candidate`, stopping as soon as it reaches `floor`. */
function hasDigitCount(candidate: string, floor: number): boolean {
  let digits = 0;
  for (let i = 0; i < candidate.length && digits < floor; i++) {
    const code = candidate.charCodeAt(i);
    if (code >= 48 && code <= 57) digits++;
  }
  return digits >= floor;
}

/**
 * The regions worth parsing one window in. A number a trunk-zero region accepts starts with
 * `0`, and one the others accept is grouped or bracketed, so a window holding neither shape
 * gets no regions and never reaches the parser.
 */
function regionsForCandidate({
  candidate,
  cued,
}: {
  candidate: string;
  cued: () => boolean;
}): readonly NationalRegion[] {
  if (CONTAINS_DATE.test(candidate)) return [];
  const trunkGroup = TRUNK_ZERO_GROUP.test(candidate);
  const groupedOrBracketed =
    hasDigitCount(candidate, SHORTEST_NO_TRUNK_MOBILE) &&
    (candidate.includes("(") || (isGrouped(candidate) && (trunkGroup || cued())));
  if (trunkGroup && groupedOrBracketed) return NATIONAL_FORMAT_REGIONS;
  if (trunkGroup) return TRUNK_ZERO_REGIONS;
  if (groupedOrBracketed) return NO_TRUNK_REGIONS;
  return [];
}

/**
 * The national-format numbers one candidate window holds, as spans of `text`. Regions are
 * tried in order until one claims the whole window, so a number costs a few parses at most.
 */
function nationalSpansInCandidate({
  text,
  candidate,
  offset,
}: {
  text: string;
  candidate: string;
  offset: number;
}): Span[] {
  const spans: Span[] = [];
  const cued = () => hasPhoneCue(text, offset);
  for (const { region, trunkZero } of regionsForCandidate({ candidate, cued })) {
    for (const phone of findPhoneNumbersInTextStrict(candidate, { defaultCountry: region })) {
      const raw = candidate.slice(phone.startsAt, phone.endsAt);
      const type = phone.number.getType();
      if (!isNationalFormatPhone({ raw, type, trunkZero, cued })) continue;
      const span: Span = {
        start: offset + phone.startsAt,
        end: offset + phone.endsAt,
        entity: "PHONE_NUMBER",
      };
      if (isPartOfLongerValue(text, span) || insideIdentifierToken(text, span)) continue;
      spans.push(span);
    }
    if (spans.some((span) => span.start === offset && span.end === offset + candidate.length)) {
      break;
    }
  }
  return spans;
}

/**
 * The parts of the window [start, end) that no span in `found` covers, scanning `found`
 * from `from` (spans in order). A window the US pass claimed in part keeps its remainder.
 */
function uncoveredParts({
  start,
  end,
  found,
  from,
}: {
  start: number;
  end: number;
  found: readonly Span[];
  from: number;
}): { start: number; end: number }[] {
  const parts: { start: number; end: number }[] = [];
  let cursor = start;
  for (let i = from; i < found.length && found[i]!.start < end; i++) {
    if (found[i]!.start > cursor) parts.push({ start: cursor, end: found[i]!.start });
    cursor = Math.max(cursor, found[i]!.end);
  }
  if (cursor < end) parts.push({ start: cursor, end });
  return parts;
}

/** One uncovered part of a candidate window, parsed when it holds enough digits. */
function collectNationalSpansInPart({
  text,
  part,
  excepted,
  spans,
}: {
  text: string;
  part: { start: number; end: number };
  excepted: (span: Span) => boolean;
  spans: Span[];
}): void {
  const candidate = text.slice(part.start, part.end);
  if (!hasDigitCount(candidate, NATIONAL_DIGIT_FLOOR)) return;
  for (const span of nationalSpansInCandidate({ text, candidate, offset: part.start })) {
    if (!excepted(span)) spans.push(span);
  }
}

/**
 * National-format pass over the digit windows, minus what the US pass already found
 * (`found`, in order), each part parsed only in the regions {@link regionsForCandidate} keeps.
 */
function collectNationalFormatPhoneSpans({
  text,
  excepted,
  found,
  spans,
}: {
  text: string;
  excepted: (span: Span) => boolean;
  found: readonly Span[];
  spans: Span[];
}): void {
  let next = 0;
  for (const match of text.matchAll(NATIONAL_CANDIDATE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    while (next < found.length && found[next]!.end <= start) next++;
    for (const part of uncoveredParts({ start, end, found, from: next })) {
      collectNationalSpansInPart({ text, part, excepted, spans });
    }
  }
}

/** International numbers (`+31 ...`, `011 ...`) and US numbers written without a country code. */
function collectInternationalOrUsPhoneSpans({
  text,
  excepted,
  spans,
}: {
  text: string;
  excepted: (span: Span) => boolean;
  spans: Span[];
}): void {
  for (const phone of findPhoneNumbersInText(text, { defaultCountry: "US" })) {
    const span: Span = {
      start: phone.startsAt,
      end: phone.endsAt,
      entity: "PHONE_NUMBER",
    };
    if (insideIdentifierToken(text, span)) continue;
    if (excepted(span)) continue;
    spans.push(span);
  }
}

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
  if (!ENOUGH_DIGITS_FOR_A_NUMBER.test(text)) return [];
  const spans: Span[] = [];
  try {
    collectInternationalOrUsPhoneSpans({ text, excepted, spans });
    collectNationalFormatPhoneSpans({ text, excepted, found: [...spans], spans });
  } catch {
    // Defensive: never let phone parsing break ingestion. Whatever the
    // detector produced before it gave up is still a real answer.
    return spans;
  }
  return spans;
}

/**
 * Collects every candidate PII span in `text`: the regex/checksum recognizers (respecting
 * `allowed`) plus the phone detector, each run through its validator/context gate and the
 * exception veto. Vetoed spans are appended to `protectedRanges` as a side effect.
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
 * Rebuilds `text` with every maskable span replaced by its typed marker. `spans` must
 * already be exception-shielded and merged for overlaps; a kept span can still overlap a
 * protected one, so each is split against `protectedRanges` first to preserve excepted text.
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
 * Redacts essential PII in `text`, returning the replaced-span count. `isAttributeValue` and
 * `shouldTreatAsIdentifier` exempt a value that is (or is claimed to be) a single
 * identifier-shaped token from all but the self-proving recognizers; free text never qualifies.
 */
export function redactEssentialPiiInText({
  text,
  entities,
  exceptPatterns,
  isAttributeValue = false,
  shouldTreatAsIdentifier = false,
}: {
  text: string;
  entities?: readonly string[];
  exceptPatterns?: readonly RegExp[];
  isAttributeValue?: boolean;
  shouldTreatAsIdentifier?: boolean;
}): PiiRedactionResult {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_SCAN_LENGTH) {
    return { text, redactedCount: 0 };
  }

  const protectedRanges: ProtectedRange[] = [];
  const spans = collectCandidateSpans({
    text,
    allowed: entities ? new Set(entities) : null,
    exceptPatterns,
    protectedRanges,
    isIdentifierShaped:
      isAttributeValue && (shouldTreatAsIdentifier || isIdentifierShapedValue(text)),
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
