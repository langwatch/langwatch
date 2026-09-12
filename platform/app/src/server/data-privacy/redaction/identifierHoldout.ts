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
 *   1. Does the attribute NAME reserve it, AND does the value look like the
 *      address that name promises? A short list of trace and span identifier
 *      names whose values a tracer mints and a person never writes. The names
 *      are not a protected namespace — the OTLP endpoint takes attributes as the
 *      caller wrote them — so the value still has to be hex or decimal before
 *      the name is allowed to turn the personal-data pass off.
 *   2. Is the VALUE exclusively one opaque identifier token? A uuid, a hex
 *      digest, a ULID, a `prefix_<random>` record id. Nothing in such a value
 *      is personal data, so there is nothing for either engine to find.
 *      Exclusively: a value that merely CONTAINS one is prose, and prose is
 *      analysed.
 *
 * WHY THERE ARE TWO VALUE RULES. The engines pay different prices for a wrong
 * answer, so they get different rules and the difference is the whole point.
 * `isIdentifierShapedValue` gates shape-only recognizers, which know nothing
 * about people, so a false positive there costs a bitcoin pattern that would
 * have misfired anyway. `isOpaqueIdentifierValue` gates the only pass that can
 * find a person or a place, so a false positive there is a name stored in the
 * clear, permanently. The second rule is therefore strictly the meaner one, and
 * the two must not be collapsed back into one however similar they look.
 *
 * WHAT IS DELIBERATELY NOT RESERVED. The correlation attributes a customer
 * fills in themselves — user, customer, thread and conversation identifiers.
 * Customers routinely put an email address or a full name in them, and a name on
 * the reserved list would mean storing that in the clear. They are covered by
 * question 2 like every other attribute: an opaque value is held back, personal
 * data is still redacted.
 */

import { METADATA_SUBKEY_PREFIXES } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";

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
 * A maximal run of letters and digits — the parts of a value either side of the
 * separators a person or a tracer writes between them.
 */
const ALPHANUMERIC_RUN = /[A-Za-z0-9]+/g;
const HEX_RUN = /^[0-9a-f]+$/i;

/**
 * The characters ONE identifier token is written with: letters, digits, the
 * separators ids use, and what remains of base64's alphabet with its padding.
 *
 * This is a whole-value gate, and it is what makes the rule below mean what its
 * name says. Without it a value qualifies as soon as it CONTAINS an opaque run,
 * so "Jane Doe handled trace_<hex>" is withheld from the only pass that finds
 * people, and the name is stored in the clear — the very failure this module
 * exists to prevent, reached from the other side. A space, a quote, a brace, a
 * comma or a slash means the text is prose or structure that HOLDS an
 * identifier, and the words around that identifier are precisely what the
 * analysis pass is for.
 *
 * `/` is left out deliberately, for the reason it is left out of
 * {@link IDENTIFIER_VALUE}: a URL path carries identifiers AND names.
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
 * Whether a whole attribute value is a machine identifier and nothing else —
 * the question asked before a value is offered to the external analysis
 * service, which is the only pass that finds names and places.
 *
 * A value qualifies on one of two grounds.
 *
 *   - It is a uuid. Uuids are written in five short groups, so no single run in
 *     them is long enough for the rule below, and they are named here directly.
 *   - It carries a run of at least sixteen letters and digits that is either
 *     all hexadecimal, or mixes letters with at least two digits. That covers a
 *     hex digest, a ULID, a `prefix_<random>` record id and a base64 token,
 *     including when a readable prefix sits in front of the random part.
 *
 * Either way the WHOLE value has to be one token first
 * ({@link OPAQUE_TOKEN_VALUE}). Carrying an identifier is not the same as being
 * one: prose that quotes a trace id is still prose, and the sentence around the
 * id is where the names are.
 *
 * Runs are measured BETWEEN separators and never across them. That is what
 * keeps "maria.schmidt.1972" out: joined up it would clear the bar, but nobody
 * types sixteen random characters in a row, and every segment of a written name
 * is short. The same applies to "Elise-Marin-Van-Toren" and
 * "Elm-Street-Apartment-4B".
 *
 * The digit requirement is what keeps "AnneMarieJohansson" out: it is one
 * eighteen-character run, long enough on length alone, and only the absence of
 * digits marks it as something a person wrote. Hex runs are exempt from the
 * digit count because a sixteen-character identifier drawn entirely from a-f
 * happens about once in eighty thousand, and no name is spelled in hex.
 *
 * THE RULE IS WRONG IN BOTH DIRECTIONS, KNOWINGLY.
 *
 * It withholds a name run together with a number, and not rarely: over a corpus
 * of `<First><Last><year>` drawn from a seeded name list, about 91% are one run
 * of sixteen or more characters carrying the two digits, so they are withheld
 * and never analysed. "MariaSchmidt1972" is the shape, and this rule cannot
 * tell it from a user id — which is what a value of that shape usually is.
 * Widening the rule to catch it means dropping the digit count, and that puts
 * every name back in scope of being withheld, so the residual is accepted
 * rather than traded. It is the larger of the two residuals here and the one to
 * reach for first if this rule is ever revisited.
 *
 * It fails to withhold a fair number of genuinely random tokens, because two
 * digits is a real bar at short lengths and because `-` and `_` split a run:
 * around 40% of nanoids and 17% of 32-character base64 tokens are submitted.
 * Those are the analysis service's problem, not this rule's, and they are no
 * worse off than before this rule existed.
 *
 * Counting `-` and `_` as part of a run is the obvious fix for the second
 * residual and it is refused, because it has been measured: nanoid hold-out
 * goes from about 59% to about 86%, and hyphenated names of the
 * "Elise-Marin-1972" shape go from 0% withheld to 100% withheld. Recovering
 * twenty-seven points of token protection by never analysing a hyphenated name
 * again is the worse side of that trade in both directions at once.
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
 * Attribute names whose value is a trace or span address minted by a tracer.
 *
 * The shape rule above already covers the usual spellings, because a trace id is
 * hex and a span id is hex. This list is for the ones it cannot see: a decimal
 * trace id (what a B3 or Datadog bridge emits) carries no letter, so the shape
 * rule reads it as a digit run and hands it to the recognizers. Naming the
 * attribute settles it without asking what the value looks like.
 *
 * Compared lower-cased, so a dialect that writes `metadata.TraceId` is covered,
 * and compared with each vendor namespace stripped, so the spellings the REST
 * collector produces are covered too (see
 * {@link isReservedIdentifierAttributeKey}).
 * Keep this list short and keep it to addresses: a name here turns the whole
 * personal-data pass off for that attribute — and then only for a value that is
 * shaped like an address, see {@link reservesTraceAddress}.
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
 *
 * Matched on the bare spelling and on every vendor namespace that canonicalises
 * to `metadata.<key>` ({@link METADATA_SUBKEY_PREFIXES}). Custom metadata does
 * not always reach redaction spelled the way the caller wrote it: the REST
 * collector rewrites each key to `langwatch.metadata.<key>` before dispatch,
 * and the fold back to `metadata.<key>` runs in the projections — after
 * redaction, which is to say after anything it destroyed is unrecoverable.
 *
 * Stripping the prefix here is deliberately preferred over listing each name
 * once per namespace: a second copy of the list is a second thing to remember,
 * and the copy that gets forgotten is the one that silently stops protecting
 * anything. Only names ALREADY on the list are reached this way — a prefix
 * widens the spellings, never the set of names.
 *
 * WHAT THIS DOES NOT COVER, STATED PLAINLY. It is a rule about attribute NAMES,
 * so it only protects senders that put metadata in attribute names. That is the
 * REST collector, and the Go SDK, which writes `metadata.<key>` directly. The
 * Python and TypeScript SDKs do NOT: both send all custom metadata as one
 * attribute literally named `metadata` holding a JSON blob, and the hoist to
 * `metadata.<key>` happens during canonicalisation, after redaction. For those
 * two SDKs the reserved names below never match, and a decimal trace id inside
 * that blob is covered only by whatever the value rules make of the blob as a
 * whole. Parsing the blob here is not the fix — that is the separate, already
 * disclosed JSON residual, and it would mean re-serialising caller data inside
 * the redaction path.
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
 * What a trace or span address is actually written as: hexadecimal (W3C, B3 and
 * the OTel SDKs) or a decimal integer (the Datadog and B3 bridges, which is the
 * case the reserved list exists for at all).
 *
 * The names above are NOT a protected namespace. Span attributes arrive on the
 * OTLP endpoint exactly as the caller wrote them, so anyone can send
 * `metadata.trace_id` holding an email address — and a name-only hold-out would
 * then turn the personal-data pass off for it and store that email in the
 * clear. Requiring the value to be address-shaped closes that without costing
 * anything real: a value this rejects is still put to the ordinary
 * {@link isOpaqueIdentifierValue} question, which is what catches a uuid-shaped
 * or prefixed trace id. Only a value that is neither an address nor an opaque
 * token loses the exemption, and that value was never an address.
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
