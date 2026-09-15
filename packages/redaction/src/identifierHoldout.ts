/**
 * Shared identifier notion for both redaction engines: redaction runs before
 * the event store, so a wrong guess is permanent. `isIdentifierShapedValue`
 * and `isOpaqueIdentifierValue` must stay separate however similar they look
 * — the latter gates the only pass that can find a person, so its false
 * positive stores a name in the clear. Deliberately NOT reserved: user,
 * customer, thread and conversation ids, since customers put real emails and names in those.
 */

/**
 * Vendor namespace prefixes that canonicalise to `metadata.<bareKey>`, kept
 * as one exported constant because redaction runs BEFORE the canonicalise
 * fold: a namespace taught to the canonicaliser but not to
 * {@link isReservedIdentifierAttributeKey} is a namespace whose trace
 * identifiers reach the recognizers unprotected. Declared here (this leaf
 * package has no workspace deps) rather than beside the canonicaliser, which imports this one.
 */
export const METADATA_SUBKEY_PREFIXES = [
  "langwatch.metadata.",
  "langwatch.trace.",
] as const;

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
 * How far the identifier rules read. Identifiers people send as references are
 * far shorter, and the cap keeps the checks flat in the ingestion path however
 * long the text is.
 */
export const MAX_IDENTIFIER_LENGTH = 256;

/**
 * Whether a whole attribute value is exclusively one identifier-shaped token
 * (letters+digits+separators, a uuid, a hex digest, or base64-style). The
 * letter requirement keeps personal data in scope: digits-only values
 * (`+31 6 12345678`, a bare card number) are never identifier-shaped here.
 */
export function isIdentifierShapedValue(value: string): boolean {
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
 * A maximal run of letters and digits — the parts of a value either side of the
 * separators a person or a tracer writes between them.
 */
const ALPHANUMERIC_RUN = /[A-Za-z0-9]+/g;
const HEX_RUN = /^[0-9a-f]+$/i;

/**
 * The characters ONE identifier token is written with. This is a whole-value
 * gate: without it, "Jane Doe handled trace_<hex>" would qualify since it
 * CONTAINS an opaque run, withholding it from the only pass that finds
 * people and storing the name in the clear. `/` is excluded deliberately —
 * a URL path carries identifiers AND names.
 */
const OPAQUE_TOKEN_VALUE = /^[A-Za-z0-9._:+=-]+$/;

/**
 * How long a run has to be before a person is unlikely to have typed it, and
 * how many digits it has to carry. A ULID is twenty-six characters, a short hex
 * span id is sixteen; the longest single-word surnames run to about eighteen,
 * and none of them carry two digits.
 */
const MIN_OPAQUE_RUN_LENGTH = 16;
const MIN_DIGITS_IN_OPAQUE_RUN = 2;

/**
 * A value qualifies as one uuid, or one run of ≥16 letters+digits that's all
 * hex or carries ≥2 digits — the whole value must be one token first
 * ({@link OPAQUE_TOKEN_VALUE}), measured between separators. This rule is
 * KNOWINGLY wrong both ways: about 91% of `<First><Last><year>` names
 * collide with this shape and are withheld unnecessarily, while about 40%
 * of nanoids and 17% of base64 tokens slip through — both are measured trade-offs, not oversights.
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
 * Whether one run between separators is longer and denser than a person writes:
 * at least {@link MIN_OPAQUE_RUN_LENGTH} characters, carrying a letter, and
 * either all hexadecimal or holding at least {@link MIN_DIGITS_IN_OPAQUE_RUN}
 * digits. Both residuals this produces are set out on
 * {@link isOpaqueIdentifierValue}, along with why neither is traded away.
 */
function isOpaqueRun(run: string): boolean {
  if (run.length < MIN_OPAQUE_RUN_LENGTH) return false;
  // A run with no letter is a digit run: a card, a phone, an account number.
  if (!HAS_LETTER.test(run)) return false;
  if (HEX_RUN.test(run)) return true;
  return (run.match(/\d/g)?.length ?? 0) >= MIN_DIGITS_IN_OPAQUE_RUN;
}

/**
 * Attribute names whose value is a trace/span address minted by a tracer.
 * The shape rule above misses decimal trace ids (B3/Datadog bridges): no
 * letter means it reads as a digit run and reaches the recognizers. Compared
 * lower-cased and with each vendor namespace stripped
 * ({@link isReservedIdentifierAttributeKey}). Keep this list short and
 * address-only — a name here turns off redaction for that attribute.
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
 * Whether this attribute name is one of the reserved trace/span addresses.
 * Matched on the bare spelling and every vendor namespace prefix
 * ({@link METADATA_SUBKEY_PREFIXES}). WHAT THIS DOES NOT COVER: the Python
 * and TypeScript SDKs send metadata as one JSON blob, hoisted to
 * `metadata.<key>` only during canonicalisation — these reserved names
 * never match for them, so a decimal trace id inside relies on the value rules.
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
 * What a trace/span address is written as: hex (W3C/B3/OTel) or decimal
 * (Datadog/B3 bridges). Names above are NOT a protected namespace — anyone
 * can send `metadata.trace_id` holding an email, so a name-only hold-out
 * would store it in the clear. Requiring address shape closes that for
 * free: a rejected value still gets the ordinary
 * {@link isOpaqueIdentifierValue} check, so a uuid-shaped trace id is still caught.
 */
const TRACE_ADDRESS_VALUE = /^(?:[0-9a-f]{8,64}|\d{1,32})$/i;

/**
 * Whether this attribute is a reserved trace/span name carrying something that
 * could be the address the name promises.
 */
export function reservesTraceAddress({
  key,
  value,
}: {
  key: string;
  value: string;
}): boolean {
  return (
    isReservedIdentifierAttributeKey(key) && TRACE_ADDRESS_VALUE.test(value)
  );
}

/**
 * Whether one attribute is held back from PII analysis altogether: reserved by
 * name, or a value that is exclusively one opaque identifier token.
 *
 * Attribute values only. Free text — a log body, a status message, the chat
 * content itself — is content by definition and always analysed.
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
