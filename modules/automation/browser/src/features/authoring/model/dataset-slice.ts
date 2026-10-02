/** A single dataset column's trace source. Mirrors the `traceMappingEntrySchema`
 *  shape the dispatcher casts to `TraceMapping`: `source` names a
 *  `TRACE_MAPPINGS` key, `key`/`subkey` drill into keyed sources. */
export interface TraceMappingEntry {
  source: string;
  key?: string;
  subkey?: string;
}

export interface DatasetMapping {
  mapping: Record<string, TraceMappingEntry>;
  expansions: string[];
}

/** The dataset provider's draft slice. */
export interface DatasetSlice {
  datasetId: string;
  mapping: DatasetMapping;
  /** Display only, filled once the dataset list loads; trusted only while its
   *  id is still the chosen one. */
  namedDataset?: { id: string; name: string };
}
