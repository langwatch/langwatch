import { VERIFIED_ATTRIBUTE_PREFIX } from "@langwatch/authorization";
import type { OtlpSpan } from "@langwatch/otlp/trace-request";
import { OtlpTraceRequestService } from "@langwatch/trace-contract/otlp-decoding";

type OtlpAttributes = OtlpSpan["attributes"];
type StoredAttributes = Readonly<Record<string, unknown>>;

/** A signed entry the API key module answered verified, with the value its signature covers. */
export type VerifiedEntry = Readonly<{ key: string; value: string; signingProjectId: string }>;

/** Whether an attribute key is a verified mark (ADR-201 §4). */
export function isVerifiedMarkKey(key: string): boolean {
  return key.startsWith(VERIFIED_ATTRIBUTE_PREFIX);
}

const normalized = (attributes: OtlpAttributes): StoredAttributes =>
  OtlpTraceRequestService.normalizeOtlpAttributes(attributes);

/**
 * The marks a span earns, decided on its attributes once admission changed them, normalised as the
 * store keeps them: one per verified entry whose value there is still exactly the signed one. Any
 * mark already on the span is removed, so an entry redacted, capped or dropped gets none.
 */
export function attributesWithVerifiedMarks({
  attributes,
  verified,
}: {
  attributes: OtlpAttributes;
  verified: readonly VerifiedEntry[];
}): OtlpAttributes {
  const unmarked = attributes.filter((attribute) => !isVerifiedMarkKey(attribute.key));
  if (verified.length === 0) return unmarked;
  const kept = normalized(unmarked);
  const marks = verified
    .filter((entry) => kept[entry.key] === entry.value)
    .map((entry) => ({
      key: `${VERIFIED_ATTRIBUTE_PREFIX}${entry.key}`,
      value: { stringValue: entry.signingProjectId },
    }));
  return [...unmarked, ...marks];
}

/**
 * The marks `after` may keep across a step that can change a span's attributes: each one the step
 * left as it was, beside an entry the step left as the same string. A new, changed, moved,
 * previewed or removed mark or entry keeps none, so a mark never outlives its signed value.
 */
function heldMarkKeys({
  before,
  after,
}: {
  before: StoredAttributes;
  after: StoredAttributes;
}): ReadonlySet<string> {
  const held = Object.keys(after).filter((markKey) => {
    if (!isVerifiedMarkKey(markKey)) return false;
    const entryKey = markKey.slice(VERIFIED_ATTRIBUTE_PREFIX.length);
    const mark = after[markKey];
    const entry = after[entryKey];
    return (
      typeof mark === "string" &&
      mark === before[markKey] &&
      typeof entry === "string" &&
      entry === before[entryKey]
    );
  });
  return new Set(held);
}

/** The span's attributes after a payload step, keeping only the marks the step left held. */
export function otlpAttributesKeepingHeldMarks({
  before,
  after,
}: {
  before: OtlpAttributes;
  after: OtlpAttributes;
}): OtlpAttributes {
  if (!after.some((attribute) => isVerifiedMarkKey(attribute.key))) return after;
  const held = heldMarkKeys({ before: normalized(before), after: normalized(after) });
  return after.filter((attribute) => !isVerifiedMarkKey(attribute.key) || held.has(attribute.key));
}

/**
 * The attributes the store keeps, decided last: a mark stays only where the stored entry is the
 * string the admitted span carried, which admission already held to the signed value.
 */
export function storedAttributesKeepingHeldMarks<V>({
  admitted,
  stored,
}: {
  admitted: OtlpAttributes;
  stored: Record<string, V>;
}): Record<string, V> {
  if (!Object.keys(stored).some(isVerifiedMarkKey)) return stored;
  const held = heldMarkKeys({ before: normalized(admitted), after: stored });
  return Object.fromEntries(
    Object.entries(stored).filter(([key]) => !isVerifiedMarkKey(key) || held.has(key)),
  );
}
