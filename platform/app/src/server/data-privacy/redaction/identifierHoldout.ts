/**
 * One notion of "this attribute is a machine identifier, not content", shared by
 * both redaction engines: the native in-process recognizers and the external
 * analysis service the strict level escalates to.
 *
 * WHY IT IS SHARED. Redaction runs BEFORE the event store, so a marker written
 * over a trace id is permanent: the original is never written down and the link
 * back to the customer's own logs is gone for good. Both engines guess, and both
 * guess wrong on opaque identifiers — a shape-only regex reads a hex id as a
 * bitcoin address, a name/place model reads one as a person or a city. Holding
 * identifiers back has to be one rule consulted twice, because a rule that only
 * one engine knows about is a rule the other engine will undo.
 *
 * Two questions are asked, in this order.
 *
 *   1. Does the attribute NAME reserve it? A short list of trace and span
 *      identifier names whose values are minted by a tracer and never written by
 *      a person. Nothing under them is ever analysed, whatever it holds.
 *   2. Is the VALUE exclusively one opaque identifier token? A uuid, a hex
 *      digest, a ULID, a `prefix_<random>` record id. Nothing in such a value
 *      is personal data, so there is nothing for either engine to find.
 *
 * WHAT IS DELIBERATELY NOT RESERVED. The correlation attributes a customer
 * fills in themselves — user, customer, thread and conversation identifiers.
 * Customers routinely put an email address or a full name in them, and a name on
 * the reserved list would mean storing that in the clear. They are covered by
 * question 2 like every other attribute: an opaque value is held back, personal
 * data is still redacted.
 */

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
 * Attribute names whose value is a trace or span address minted by a tracer.
 *
 * The shape rule above already covers the usual spellings, because a trace id is
 * hex and a span id is hex. This list is for the ones it cannot see: a decimal
 * trace id (what a B3 or Datadog bridge emits) carries no letter, so the shape
 * rule reads it as a digit run and hands it to the recognizers. Naming the
 * attribute settles it without asking what the value looks like.
 *
 * Compared lower-cased, so a dialect that writes `metadata.TraceId` is covered.
 * Keep this list short and keep it to addresses: a name here turns the whole
 * personal-data pass off for that attribute.
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

/** Whether this attribute name is one of the reserved trace/span addresses. */
export function isReservedIdentifierAttributeKey(key: string): boolean {
  return RESERVED_IDENTIFIER_ATTRIBUTE_KEYS.has(key.toLowerCase());
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
  return (
    isReservedIdentifierAttributeKey(key) || isIdentifierShapedValue(value)
  );
}
