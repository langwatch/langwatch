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
