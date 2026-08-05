/**
 * Shared decoders for ClickHouse `JSONEachRow` records (ADR-066 read-back).
 *
 * ClickHouse serialises a `JSONEachRow` result as loosely-typed JSON: Int64 /
 * UInt64 columns come back as strings (a JSON number can't round-trip past
 * 2^53), Float64 columns as numbers, Array / Map columns as themselves, and an
 * absent column is simply missing from the object. These coercers give the
 * analytics read-back repositories a single definition of each primitive decode
 * so the `trace_analytics` and `evaluation_analytics` `fromRecord` mappers stay
 * byte-for-byte consistent instead of carrying private copies.
 *
 * Column-specific decoders (e.g. epoch-ms `0 -> null`, nullable booleans) stay
 * local to their repository until a second consumer appears.
 */

export const asNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const asNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

export const asStringMap = (value: unknown): Record<string, string> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, v]) => typeof v === "string")
          .map(([k, v]) => [k, v as string]),
      )
    : {};

export const asNullableString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;
