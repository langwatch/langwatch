/**
 * ADR-033 — result-by-reference plumbing.
 *
 * A run result references the dataset row it evaluated by its stable id instead
 * of (eventually) copying heavy columns back in. The reference rides inside the
 * existing result `entry` record under a reserved namespace — mirroring
 * ADR-022's `langwatch.reserved.*` convention — so no projection/ClickHouse
 * schema change is needed, and the keys are filtered out of any user-visible
 * column enumeration (`isReservedResultKey`).
 *
 * Slice 1 (this commit) only ATTACHES the reference (the red-team Blocker-1 fix:
 * the stable id now exists end-to-end in the run path). Stripping heavy columns
 * and resolving the reference at read time land in later slices, gated by the
 * `release_dataset_streaming_reads` flag.
 */

export const RESERVED_DATASET_ID_KEY = "langwatch.reserved.datasetId";
export const RESERVED_ROW_ID_KEY = "langwatch.reserved.rowId";

/**
 * Per-column size gate at result-write (ADR-033 Constants, mirrors ADR-022's
 * IO_PREVIEW_BYTES). A column value under this is copied inline into the result;
 * over it is dropped and resolved at read from the referenced dataset row.
 */
export const RESULT_INLINE_BYTES = 64 * 1024;

/** Byte size of a single column value (string measured directly; else serialized). */
const columnByteSize = (value: unknown): number => {
  if (value == null) return 0;
  const str = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.byteLength(str ?? "", "utf-8");
};

/** True for any reserved result-reference key (hide these from visible columns). */
export const isReservedResultKey = (key: string): boolean =>
  key === RESERVED_DATASET_ID_KEY || key === RESERVED_ROW_ID_KEY;

/**
 * Return a copy of `entry` carrying the dataset-row reference. No-op (returns
 * `entry` unchanged) when there is no stable `rowId` — inline datasets and
 * id-less rows keep today's full-copy shape.
 */
export const withRowReference = (
  entry: Record<string, unknown>,
  ref: { datasetId?: string; rowId?: string },
): Record<string, unknown> => {
  if (!ref.rowId) return entry;
  return {
    ...entry,
    [RESERVED_DATASET_ID_KEY]: ref.datasetId,
    [RESERVED_ROW_ID_KEY]: ref.rowId,
  };
};

/**
 * Build the stored result `entry` for a run (ADR-033 Decision 3).
 *
 * - `enabled: false` (flag off) OR no stable `rowId` → returns the FULL row
 *   (with the reference attached when a rowId exists) — today's behavior,
 *   byte-for-byte (I-COMPAT).
 * - `enabled: true` with a `rowId` → LEAN shape: columns at or under
 *   `inlineMaxBytes` are kept inline (grid stays readable + searchable); heavier
 *   columns are dropped and resolved at read from the referenced row. The
 *   reserved reference keys are always preserved.
 */
export const leanResultEntry = (
  entry: Record<string, unknown>,
  ref: { datasetId?: string; rowId?: string },
  opts: { enabled: boolean; inlineMaxBytes?: number },
): Record<string, unknown> => {
  const withRef = withRowReference(entry, ref);
  if (!opts.enabled || !ref.rowId) return withRef;

  const inlineMaxBytes = opts.inlineMaxBytes ?? RESULT_INLINE_BYTES;
  const lean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(withRef)) {
    // Reference keys always survive; light columns inline; heavy dropped.
    if (isReservedResultKey(key) || columnByteSize(value) <= inlineMaxBytes) {
      lean[key] = value;
    }
  }
  return lean;
};

/** Read the dataset-row reference back off a stored result `entry`, if present. */
export const readRowReference = (
  entry: Record<string, unknown> | null | undefined,
): { datasetId?: string; rowId: string } | null => {
  const rowId = entry?.[RESERVED_ROW_ID_KEY];
  if (typeof rowId !== "string" || !rowId) return null;
  const datasetId = entry?.[RESERVED_DATASET_ID_KEY];
  return {
    datasetId: typeof datasetId === "string" ? datasetId : undefined,
    rowId,
  };
};

/** Shown for a heavy column whose referenced dataset row was edited away or deleted. */
export const HEAVY_COLUMN_UNAVAILABLE = "[unavailable]";

/**
 * Rebuild the display entry for a stored result (ADR-033 Decision 4, I-RESULT-LIGHT).
 *
 * - Light columns kept inline at write time are used as-is.
 * - Heavy columns that were dropped (a lean, referenced result) are filled from
 *   the resolved dataset `row`; if the row is gone (edited away / deleted),
 *   they degrade to `HEAVY_COLUMN_UNAVAILABLE` — never a crash.
 * - Legacy / full-copy results (no reference) pass through unchanged.
 * - Reserved reference keys are excluded (only `columnNames` are emitted).
 *
 * `row` is resolved by the caller within the result's project (I-TENANT).
 */
export const resolveLeanEntry = (params: {
  storedEntry: Record<string, unknown>;
  columnNames: string[];
  row: Record<string, unknown> | null;
}): Record<string, unknown> => {
  const { storedEntry, columnNames, row } = params;
  const isReferenced = readRowReference(storedEntry) !== null;

  const display: Record<string, unknown> = {};
  for (const col of columnNames) {
    if (Object.prototype.hasOwnProperty.call(storedEntry, col)) {
      // Inline light column (or any column on a legacy full-copy result).
      display[col] = storedEntry[col];
    } else if (isReferenced) {
      // Heavy column dropped at write → resolve from the row, else "unavailable".
      display[col] = row?.[col] ?? HEAVY_COLUMN_UNAVAILABLE;
    }
  }
  return display;
};
