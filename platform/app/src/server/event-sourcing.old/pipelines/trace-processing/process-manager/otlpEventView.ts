/**
 * Total readers for the handful of attributes a trace-keyed process needs off
 * a raw OTLP event.
 *
 * Deliberately NOT `normalizeOtlpAttributeMap`: that flattens, reconstructs
 * arrays and JSON-parses the WHOLE attribute set, which on a span means
 * parsing the prompts and completions the content boundary exists to keep out.
 * A process asks a handful of single-key questions, so these read one key at a
 * time.
 *
 * Every function here is TOTAL. They run inside `toPayload`, against untrusted
 * wire data behind a cast, so an unrecognised shape reads as absent rather
 * than throwing — a throw there is a delivery failure on an event the process
 * cannot skip.
 */

/** The span an event carries, when it carries one. */
export function spanOf(
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const span = data.span;
  return typeof span === "object" && span !== null
    ? (span as Record<string, unknown>)
    : null;
}

/** The resource an event carries, when it carries one. */
export function resourceOf(
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  const resource = data.resource;
  return typeof resource === "object" && resource !== null
    ? (resource as Record<string, unknown>)
    : null;
}

/** Reads one string attribute out of a raw OTLP `KeyValue[]`. */
export function readOtlpString(
  attributes: unknown,
  key: string,
): string | null {
  const value = readOtlpValue(attributes, key);
  if (value === null) return null;
  const text = (value as { stringValue?: unknown }).stringValue;
  return typeof text === "string" && text.length > 0 ? text : null;
}

/** Whether the key is present at all, whatever type it carries. */
export function hasOtlpKey(attributes: unknown, key: string): boolean {
  if (!Array.isArray(attributes)) return false;
  return attributes.some(
    (attribute) =>
      typeof attribute === "object" &&
      attribute !== null &&
      (attribute as { key?: unknown }).key === key,
  );
}

/**
 * Reads one attribute as a finite number.
 *
 * OTLP `AnyValue` is a union, and the same integer reaches us as `intValue`,
 * `stringValue` or `doubleValue` depending on which SDK encoded it — so every
 * encoding that parses to a finite number is accepted, and anything else reads
 * as absent.
 */
export function readOtlpNumber(
  attributes: unknown,
  key: string,
): number | null {
  const value = readOtlpValue(attributes, key);
  if (value === null) return null;

  const raw =
    typeof value === "object"
      ? ((value as Record<string, unknown>).intValue ??
        (value as Record<string, unknown>).stringValue ??
        (value as Record<string, unknown>).doubleValue ??
        value)
      : value;

  const parsed =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseFloat(raw)
        : Number.NaN;

  return Number.isFinite(parsed) ? parsed : null;
}

/** The raw `AnyValue` for a key, or null when the key is absent. */
function readOtlpValue(attributes: unknown, key: string): unknown {
  if (!Array.isArray(attributes)) return null;
  for (const attribute of attributes) {
    if (typeof attribute !== "object" || attribute === null) continue;
    const entry = attribute as { key?: unknown; value?: unknown };
    if (entry.key !== key) continue;
    return entry.value ?? null;
  }
  return null;
}
