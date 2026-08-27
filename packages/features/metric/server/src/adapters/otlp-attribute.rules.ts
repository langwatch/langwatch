import { z } from "zod";

const otlpIntSchema = z.union([
  z.number(),
  z.string(),
  z.object({ low: z.number(), high: z.number() }),
]);

export const otlpAnyValueSchema: z.ZodType<{
  stringValue?: string | null;
  boolValue?: boolean | string | null;
  intValue?: number | string | { low: number; high: number } | null;
  doubleValue?: number | string | null;
  arrayValue?: { values: OtlpAnyValue[] } | null;
  kvlistValue?: { values: Array<{ key: string; value: OtlpAnyValue }> } | null;
  bytesValue?: Uint8Array | string | Record<string, number> | null;
}> = z.lazy(() =>
  z
    .object({
      stringValue: z.string().nullable().optional(),
      boolValue: z.union([z.boolean(), z.string()]).nullable().optional(),
      intValue: otlpIntSchema.nullable().optional(),
      doubleValue: z.union([z.number(), z.string()]).nullable().optional(),
      bytesValue: z
        .union([z.instanceof(Uint8Array), z.string(), z.record(z.string(), z.number())])
        .nullable()
        .optional(),
      arrayValue: z
        .object({ values: z.array(otlpAnyValueSchema) })
        .nullable()
        .optional(),
      kvlistValue: z
        .object({
          values: z.array(z.object({ key: z.string(), value: otlpAnyValueSchema })),
        })
        .nullable()
        .optional(),
    })
    .passthrough(),
);

export type OtlpAnyValue = z.infer<typeof otlpAnyValueSchema>;

const otlpKeyValueSchema = z.object({ key: z.string(), value: otlpAnyValueSchema });

function scalar(value: OtlpAnyValue): string | boolean | number | Uint8Array | undefined {
  if (typeof value.stringValue === "string") return value.stringValue;
  if (value.boolValue !== undefined && value.boolValue !== null) {
    return typeof value.boolValue === "string"
      ? value.boolValue.toLowerCase() === "true"
      : value.boolValue;
  }
  if (value.intValue !== undefined && value.intValue !== null) {
    if (typeof value.intValue === "object") {
      return Number(
        (BigInt(value.intValue.high) << 32n) | (BigInt(value.intValue.low) & 0xffffffffn),
      );
    }
    return typeof value.intValue === "string"
      ? Number.parseInt(value.intValue, 10)
      : value.intValue;
  }
  if (value.doubleValue !== undefined && value.doubleValue !== null) {
    return typeof value.doubleValue === "string"
      ? Number.parseFloat(value.doubleValue)
      : value.doubleValue;
  }
  if (value.bytesValue instanceof Uint8Array) return value.bytesValue;
  if (typeof value.bytesValue === "string") return Buffer.from(value.bytesValue, "base64");
  if (value.arrayValue && value.arrayValue.values.every((item) => scalar(item) !== undefined)) {
    return JSON.stringify(value.arrayValue.values.map((item) => scalar(item)));
  }
  return undefined;
}

function flatten(value: OtlpAnyValue, prefix: string, output: Record<string, unknown>): void {
  const primitive = scalar(value);
  if (primitive !== undefined) {
    output[prefix] = primitive;
    return;
  }
  if (value.kvlistValue) {
    for (const child of value.kvlistValue.values) {
      flatten(child.value, prefix ? `${prefix}.${child.key}` : child.key, output);
    }
    return;
  }
  if (value.arrayValue) {
    value.arrayValue.values.forEach((child, index) => flatten(child, `${prefix}.${index}`, output));
  }
}

function normalizeOtlpAttributeMap(attributes: unknown): Record<string, string> {
  if (!Array.isArray(attributes)) return {};
  const flattened: Record<string, unknown> = {};
  for (const raw of attributes) {
    const entry = otlpKeyValueSchema.safeParse(raw);
    if (!entry.success) continue;
    flatten(entry.data.value, entry.data.key, flattened);
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(flattened)) {
    if (value instanceof Uint8Array) result[key] = Buffer.from(value).toString("hex");
    else if (Array.isArray(value)) result[key] = JSON.stringify(value);
    else if (typeof value === "string") {
      const trimmed = value.trim();
      if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        try {
          result[key] = JSON.stringify(JSON.parse(trimmed));
          continue;
        } catch {
          // Keep malformed JSON as the sender supplied it.
        }
      }
      result[key] = value;
    } else if (value !== undefined && value !== null) result[key] = String(value);
  }
  return result;
}

export { normalizeOtlpAttributeMap };
