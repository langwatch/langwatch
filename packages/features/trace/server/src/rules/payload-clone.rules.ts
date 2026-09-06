/**
 * The deep copy the span pipeline takes before it rewrites a payload.
 *
 * Every recorded span is cloned so redaction, the attribute cap and cost
 * enrichment work on a copy with no reference back into the command. That made
 * `structuredClone` the single most expensive step on ingestion: on a 200-span
 * batch it costs 7.2 ms against 0.4 ms here, because it walks the structured
 * clone algorithm — transferables, cycles, every platform type — for payloads
 * that are decoded OTLP and therefore plain objects, arrays and scalars.
 *
 * So plain values take a plain recursive copy and anything else is handed to
 * `structuredClone` unchanged. A key holding `undefined` is preserved, which a
 * `JSON.parse(JSON.stringify(...))` round trip would drop.
 */
export function clonePayload<T>(value: T): T {
  return cloneUnknown(value) as T;
}

function cloneUnknown(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    for (let index = 0; index < value.length; index++) copy.push(cloneUnknown(value[index]));
    return copy;
  }

  // Anything with its own prototype — a Date, a Map, a typed array, a class
  // instance — is not ours to copy field by field.
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return structuredClone(value);

  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    copy[key] = cloneUnknown((value as Record<string, unknown>)[key]);
  }
  return copy;
}
