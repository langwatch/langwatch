import { createHash } from "node:crypto";

export type UnknownRecord = Record<string, unknown>;

/**
 * Accepts arrays too (`typeof [] === "object"`), deliberately: every caller
 * here only ever asks "can I index a named field off this node", and an array
 * answers that honestly — a missing key reads as `undefined` and the caller
 * rejects the node. Do not reuse this for the log pipeline's array-excluding
 * variant; an OTLP log body is an `AnyValue` union where `arrayValue` and
 * `kvlistValue` are distinct cases, and conflating them changes identity.
 */
export const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === "object";

/**
 * Deterministic JSON: object keys sort, array order is preserved (arrays are
 * positionally meaningful in OTLP; objects are not). Every non-JSON-native
 * value gets a stable, lossless encoding — `undefined` and non-finite numbers
 * become sentinels rather than the `null` `JSON.stringify` would emit, `bigint`
 * its decimal string, `Uint8Array` base64.
 */
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
      if (seen.has(current)) {
        throw new Error("cannot canonicalize cyclic OTLP data");
      }
      seen.add(current);
      const out: UnknownRecord = {};
      for (const key of Object.keys(current).sort()) {
        out[key] = normalize(current[key]);
      }
      seen.delete(current);
      return out;
    }
    return current;
  };
  return JSON.stringify(normalize(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
