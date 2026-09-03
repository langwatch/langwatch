import { z } from "zod";

/**
 * OTLP's `AnyValue`, as it actually arrives rather than as the spec draws it.
 *
 * The spec makes `AnyValue` a `oneof`, so exactly one field is set. This schema
 * does not enforce that, and every field is `.nullable().optional()`, because
 * the senders do not honour it: protobuf-JSON emits absent fields as `null`,
 * some SDKs emit `""` alongside a set `intValue`, and the collector's own JSON
 * encoding differs from the binary one for the same value. A schema that
 * enforced the `oneof` would reject payloads the ingestion path is required to
 * accept, so exclusivity is a reading concern — {@link otlpScalarValue} takes
 * the fields in a fixed order — rather than a parsing one.
 *
 * The scalar fields accept more than their nominal type for the same reason:
 *
 *   - `intValue` arrives as a number, as a decimal string (protobuf-JSON emits
 *     64-bit integers as strings, since JSON numbers cannot hold them), or as
 *     `{ low, high }` when a Long has been serialised structurally.
 *   - `boolValue` and `doubleValue` arrive as strings from senders that
 *     stringify their whole payload.
 *   - `bytesValue` arrives as a `Uint8Array`, as base64, or — when a
 *     `Uint8Array` has been through `JSON.stringify` — as an object keyed by
 *     numeric index.
 *
 * `passthrough` keeps fields a newer OTLP revision adds rather than dropping
 * them silently.
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
