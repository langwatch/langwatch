/** The slice of the OTLP `AnyValue`/`KeyValue` wire shape this pipeline reads. */

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
