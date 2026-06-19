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
