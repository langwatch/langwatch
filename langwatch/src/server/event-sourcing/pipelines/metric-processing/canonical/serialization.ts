import { createHash } from "node:crypto";

export type UnknownRecord = Record<string, unknown>;

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

/**
 * Ordinal (UTF-16 code-unit) comparison. Identity hashing must never depend on
 * the host locale or ICU build, so canonical ordering cannot use
 * `localeCompare`: two workers would otherwise derive different SeriesIds and
 * PointIds from the same attributes.
 */
export function compareOrdinal(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
