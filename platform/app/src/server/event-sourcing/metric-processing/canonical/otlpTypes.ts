/**
 * The slice of the OTLP `AnyValue`/`KeyValue` wire shape this pipeline reads.
 *
 * Deliberately local and minimal rather than imported from the trace pipeline
 * — this pipeline does not depend on another pipeline's schema module, and an
 * OTLP attribute's shape is a protocol fact this file can state on its own.
 */

export interface OtlpAnyValue {
  stringValue?: string | null;
  boolValue?: boolean | string | null;
  intValue?: number | string | { low: number; high: number } | null;
  doubleValue?: number | string | null;
  arrayValue?: { values: OtlpAnyValue[] } | null;
  kvlistValue?: { values: OtlpKeyValue[] } | null;
  bytesValue?: Uint8Array | string | Record<string, number> | null;
}

export interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}
