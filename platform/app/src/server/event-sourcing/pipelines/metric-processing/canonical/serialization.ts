import { createHash } from "node:crypto";

export type UnknownRecord = Record<string, unknown>;

export const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === "object";

function normalizeRecord(
  current: UnknownRecord,
  seen: WeakSet<object>,
): UnknownRecord {
  if (seen.has(current))
    throw new Error("Cannot canonicalize cyclic OTLP data");
  seen.add(current);
  const result: UnknownRecord = {};
  for (const key of Object.keys(current).sort()) {
    result[key] = normalize(current[key], seen);
  }
  seen.delete(current);
  return result;
}

function normalize(current: unknown, seen: WeakSet<object>): unknown {
  if (current === undefined) return { $undefined: true };
  if (typeof current === "bigint") return current.toString();
  if (typeof current === "number" && !Number.isFinite(current)) {
    return { $number: String(current) };
  }
  if (current instanceof Uint8Array) {
    return { $bytes: Buffer.from(current).toString("base64") };
  }
  if (Array.isArray(current)) {
    return current.map((item) => normalize(item, seen));
  }
  if (isRecord(current)) return normalizeRecord(current, seen);
  return current;
}

/** Deterministic JSON: object keys sort; array order remains meaningful. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value, new WeakSet<object>()));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
