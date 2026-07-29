import { createHash } from "node:crypto";

export type UnknownRecord = Record<string, unknown>;

/**
 * Accepts arrays as records (`typeof [] === "object"`) — deliberately. The
 * metric canonicalisers only ever ask "can I index into this?" before reading
 * named fields off an OTLP node, and an array answers that honestly: a missing
 * key just reads as undefined and the caller rejects the node.
 *
 * The log path needs the opposite answer and keeps its own array-excluding
 * copy (`canonicalLog.ts`), because an OTLP log body is an AnyValue union
 * where arrayValue and kvlistValue are distinct cases and conflating them
 * would change a RecordId. Do not "unify" the two.
 */
export const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === "object";

/** Deterministic JSON: object keys sort; array order remains meaningful. */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (current: unknown): unknown => {
    if (current === undefined) return { $undefined: true };
    if (typeof current === "bigint") return current.toString();
    if (typeof current === "number" && !Number.isFinite(current)) {
      return { $number: String(current) };
    }
    if (current instanceof Uint8Array) {
      return { $bytes: Buffer.from(current).toString("base64") };
    }
    if (Array.isArray(current)) return current.map(normalize);
    if (isRecord(current)) {
      if (seen.has(current))
        throw new Error("Cannot canonicalize cyclic OTLP data");
      seen.add(current);
      const result: UnknownRecord = {};
      for (const key of Object.keys(current).sort()) {
        result[key] = normalize(current[key]);
      }
      seen.delete(current);
      return result;
    }
    return current;
  };
  return JSON.stringify(normalize(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
