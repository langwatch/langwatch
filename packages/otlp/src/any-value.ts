import { z } from "zod";

/**
 * OTLP's AnyValue as it actually arrives (not as the spec draws it).
 * Fields are nullable/optional; senders don't honour the spec's oneof.
 * Scalar fields accept multiple types due to protobuf-JSON quirks.
 */
export const otlpAnyValueSchema: z.ZodType<{
  stringValue?: string | null;
  boolValue?: boolean | string | null;
  intValue?: number | string | { low: number; high: number } | null;
  doubleValue?: number | string | null;
  arrayValue?: { values: OtlpAnyValue[] } | null;
  kvlistValue?: { values: { key: string; value: OtlpAnyValue }[] } | null;
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

/** A 64-bit integer, in each of the three encodings OTLP senders use. */
const otlpIntSchema = z.union([
  z.number(),
  z.string(),
  z.object({ low: z.number(), high: z.number() }),
]);

export type OtlpAnyValue = z.infer<typeof otlpAnyValueSchema>;

/** One OTLP attribute: a key and the value it carries. */
export const otlpKeyValueSchema = z.object({ key: z.string(), value: otlpAnyValueSchema });

export type OtlpKeyValue = z.infer<typeof otlpKeyValueSchema>;

/** The hex spelling of a byte string, two lower-case digits per byte. */
export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/**
 * Distinguishes base64 (protobuf-JSON) from hex by base64's distinctive
 * characters, not validity — a hex id is also valid base64, so decoding it
 * would corrupt it. An ambiguous string passes through unchanged.
 */
export function decodeBase64OpenTelemetryId(value: unknown): string | null {
  if (value instanceof Uint8Array) return bytesToHex(value);
  if (typeof value !== "string") return null;
  if (!/[+/=]/.test(value)) return value;
  try {
    return Buffer.from(value, "base64").toString("hex");
  } catch {
    return value;
  }
}
