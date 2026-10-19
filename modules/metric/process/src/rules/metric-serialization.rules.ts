import { createHash } from "node:crypto";

export type UnknownRecord = Record<string, unknown>;
type NormalizeValue = (current: unknown) => unknown;

export const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === "object";

function normalizeRecord({
  current,
  normalizeValue,
  seen,
}: {
  current: UnknownRecord;
  normalizeValue: NormalizeValue;
  seen: WeakSet<object>;
}): UnknownRecord {
  if (seen.has(current)) throw new Error("Cannot canonicalize cyclic OTLP data");
  seen.add(current);
  const result: UnknownRecord = {};
  for (const key of Object.keys(current).toSorted()) {
    result[key] = normalizeValue(current[key]);
  }
  seen.delete(current);
  return result;
}

/** Deterministic JSON: object keys sort; array order remains meaningful. */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize: NormalizeValue = (current) => {
    if (current === undefined) return { $undefined: true };
    if (typeof current === "bigint") return current.toString();
    if (typeof current === "number" && !Number.isFinite(current)) {
      return { $number: String(current) };
    }
    if (current instanceof Uint8Array) {
      return { $bytes: Buffer.from(current).toString("base64") };
    }
    if (Array.isArray(current)) return current.map(normalize);
    if (isRecord(current)) return normalizeRecord({ current, normalizeValue: normalize, seen });
    return current;
  };
  return JSON.stringify(normalize(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
