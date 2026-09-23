/**
 * Redaction runs before the event store, so a wrong guess is permanent.
 * `isIdentifierShapedValue`/`isOpaqueIdentifierValue` must stay separate:
 * the latter gates the only PII-finding pass, so a false positive stores a name in the clear.
 */

/**
 * Kept as one exported constant because redaction runs BEFORE the
 * canonicalise fold: a namespace taught to the canonicaliser but not here
 * reaches the recognizers unprotected. Declared here — this leaf package has no workspace deps.
 */
export const METADATA_SUBKEY_PREFIXES = ["langwatch.metadata.", "langwatch.trace."] as const;

const HAS_LETTER = /[A-Za-z]/;
const HAS_DIGIT = /\d/;
const HAS_LOWERCASE = /[a-z]/;
const HAS_UPPERCASE = /[A-Z]/;
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RUN_VALUE = /^[0-9a-f]{16,}$/i;
const BASE64ISH_VALUE = /^[A-Za-z0-9+/_=-]{16,}$/;

/**
 * The characters an identifier is written with: letters, digits, and ids'
 * separators. A quote, brace, comma or slash means the text is structure
 * that HOLDS values, so minified JSON and URLs stay fully scanned.
 */
const IDENTIFIER_VALUE = /^[A-Za-z0-9._:-]+$/;

/**
 * How far the identifier rules read. Identifiers people send as references are
 * far shorter, and the cap keeps the checks flat in the ingestion path however
 * long the text is.
 */
export const MAX_IDENTIFIER_LENGTH = 256;

/** Whether `value` is digit-bearing and written with only identifier characters. */
function isDigitBearingIdentifier(value: string): boolean {
  if (!HAS_DIGIT.test(value)) return false;
  return IDENTIFIER_VALUE.test(value);
}

/**
 * One identifier-shaped token (letters+digits+separators, uuid, hex digest,
 * or base64-style). The letter requirement keeps personal data in scope:
 * digits-only values (`+31 6 12345678`, a bare card number) are never identifier-shaped.
 */
export function isIdentifierShapedValue(value: string): boolean {
  if (value.length > MAX_IDENTIFIER_LENGTH || !HAS_LETTER.test(value)) {
    return false;
  }
  if (isDigitBearingIdentifier(value)) return true;
  if (UUID_VALUE.test(value)) return true;
  if (HEX_RUN_VALUE.test(value)) return true;
  return BASE64ISH_VALUE.test(value) && HAS_LOWERCASE.test(value) && HAS_UPPERCASE.test(value);
}

/**
 * A maximal run of letters and digits — the parts of a value either side of the
 * separators a person or a tracer writes between them.
 */
const ALPHANUMERIC_RUN = /[A-Za-z0-9]+/g;
const HEX_RUN = /^[0-9a-f]+$/i;

/**
 * The whole-value gate: without it, "Jane Doe handled trace_<hex>" would
 * qualify by CONTAINING an opaque run, withholding a name from the only
 * PII-finding pass. `/` is excluded since a URL carries identifiers AND names.
 */
const OPAQUE_TOKEN_VALUE = /^[A-Za-z0-9._:+=-]+$/;

/**
 * How long a run must be, and how many digits, before a person is unlikely
 * to have typed it. A ULID is 26 chars, a short hex span id 16; the longest
 * single-word surnames run to about 18, and none carry two digits.
 */
const MIN_OPAQUE_RUN_LENGTH = 16;
const MIN_DIGITS_IN_OPAQUE_RUN = 2;

/**
 * One uuid, or a run of ≥16 letters+digits that's all hex or carries ≥2
 * digits, measured between separators. KNOWINGLY wrong both ways (measured, not
 * oversight): ~91% of name-shaped values collide; ~40% of nanoids, 17% of base64 slip through.
 */
export function isOpaqueIdentifierValue(value: string): boolean {
  if (value.length > MAX_IDENTIFIER_LENGTH) return false;
  if (!OPAQUE_TOKEN_VALUE.test(value)) return false;
  if (UUID_VALUE.test(value)) return true;

  for (const [run] of value.matchAll(ALPHANUMERIC_RUN)) {
    if (isOpaqueRun(run)) return true;
  }
  return false;
}

/**
 * Longer and denser than a person writes: at least
 * {@link MIN_OPAQUE_RUN_LENGTH} chars, a letter, and either all hex or
 * {@link MIN_DIGITS_IN_OPAQUE_RUN}+ digits. Residuals: see {@link isOpaqueIdentifierValue}.
 */
function isOpaqueRun(run: string): boolean {
  if (run.length < MIN_OPAQUE_RUN_LENGTH) return false;
  // A run with no letter is a digit run: a card, a phone, an account number.
  if (!HAS_LETTER.test(run)) return false;
  if (HEX_RUN.test(run)) return true;
  return (run.match(/\d/g)?.length ?? 0) >= MIN_DIGITS_IN_OPAQUE_RUN;
}

/**
 * The shape rule above misses decimal trace ids (no letter, so it reads as
 * a digit run): this list catches those. Keep it short and address-only —
 * a name here turns off redaction for that attribute.
 */
const RESERVED_IDENTIFIER_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  "metadata.oteltraceid",
  "metadata.otelspanid",
  "metadata.traceid",
  "metadata.spanid",
  "metadata.trace_id",
  "metadata.span_id",
  "trace_id",
  "span_id",
  "traceid",
  "spanid",
]);

/**
 * Matched on the bare spelling and vendor namespace prefixes. DOES NOT
 * COVER SDK metadata sent as one JSON blob, hoisted to `metadata.<key>`
 * only at canonicalisation — a decimal trace id inside relies on the value rules.
 */
export function isReservedIdentifierAttributeKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (RESERVED_IDENTIFIER_ATTRIBUTE_KEYS.has(lower)) return true;
  return METADATA_SUBKEY_PREFIXES.some(
    (prefix) =>
      lower.startsWith(prefix) &&
      RESERVED_IDENTIFIER_ATTRIBUTE_KEYS.has(lower.slice(prefix.length)),
  );
}

/**
 * Hex (W3C/B3/OTel) or decimal (Datadog/B3 bridges). Names above are NOT a
 * protected namespace — anyone can send `metadata.trace_id` holding an
 * email, so address shape is required to avoid storing it in the clear.
 */
const TRACE_ADDRESS_VALUE = /^(?:[0-9a-f]{8,64}|\d{1,32})$/i;

/**
 * Whether this attribute is a reserved trace/span name carrying something that
 * could be the address the name promises.
 */
export function reservesTraceAddress({ key, value }: { key: string; value: string }): boolean {
  return isReservedIdentifierAttributeKey(key) && TRACE_ADDRESS_VALUE.test(value);
}

/**
 * Held back from PII analysis: reserved by name, or a value that's
 * exclusively one opaque identifier token. Attribute values only — free
 * text (a log body, a status message, chat content) is always analysed.
 */
export function isHeldOutIdentifierAttribute({
  key,
  value,
}: {
  key: string;
  value: string;
}): boolean {
  return reservesTraceAddress({ key, value }) || isOpaqueIdentifierValue(value);
}
