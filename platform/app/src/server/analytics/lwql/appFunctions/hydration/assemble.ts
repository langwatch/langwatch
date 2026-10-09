/**
 * The last step of the hydration stage: the rows, the ceiling on them, and the
 * types the columns are re-declared with.
 *
 * @see ../hydrate.ts
 */

import type { LangWatchQLColumn } from "../../executor";
import { appFunctionKeyId, appFunctionKeyParts } from "../keys";
import type {
  ComputedValue,
  ComputedValues,
  LangWatchQLEvalUsage,
  LangWatchQLHydrationInput,
  LangWatchQLHydrationResult,
  LangWatchQLHydrationTimings,
  ResolvedCall,
} from "./contract";

// ---------------------------------------------------------------------------
// Assembling the answer
// ---------------------------------------------------------------------------

export function assembleResult({
  input,
  resolved,
  computed,
  evalUsage,
  timings,
  isCancelled = false,
}: {
  input: LangWatchQLHydrationInput;
  resolved: readonly ResolvedCall[];
  computed: ComputedValues;
  evalUsage?: LangWatchQLEvalUsage;
  timings?: LangWatchQLHydrationTimings;
  /** Whether the judging stopped early, leaving some judged cells absent. */
  isCancelled?: boolean;
}): LangWatchQLHydrationResult {
  const { hydrated, unjudgedRows } = hydrateRows({
    rows: input.rows,
    resolved,
    computed,
    isCancelled,
  });

  const { rows, isTruncatedByBytes } = applyHydratedByteCeiling({
    rows: hydrated,
    maxHydratedBytes: input.limits.maxHydratedBytes,
  });

  return {
    columns: retypeColumns({ columns: input.columns, resolved }),
    rows,
    isTruncatedByBytes,
    valueTruncations: resolved
      .map((entry) => ({
        column: entry.call.column,
        function: entry.definition.name,
        values: countWhere({
          computed,
          entry,
          predicate: (v) => v.isTruncated,
        }),
      }))
      .filter((report) => report.values > 0),
    unresolvedKeys: resolved
      .map((entry) => ({
        column: entry.call.column,
        function: entry.definition.name,
        keys: countWhere({ computed, entry, predicate: (v) => !v.isResolved }),
      }))
      .filter((report) => report.keys > 0),
    ...(evalUsage ? { evalUsage } : {}),
    ...(timings ? { timings } : {}),
    // The ceiling above may have dropped trailing rows; an index past them
    // would name a row the caller cannot see.
    ...(isCancelled
      ? {
          cancellation: {
            unjudgedRows: unjudgedRows.filter((index) => index < rows.length),
          },
        }
      : {}),
  };
}

/**
 * Puts every computed value in its cell, and names the rows a cancellation
 * left without one.
 *
 * An absent cell on a judged column is a unit the abort reached before the
 * answer did, which is the one null a caller must not read as a verdict.
 */
function hydrateRows({
  rows,
  resolved,
  computed,
  isCancelled,
}: {
  rows: readonly Record<string, unknown>[];
  resolved: readonly ResolvedCall[];
  computed: ComputedValues;
  isCancelled: boolean;
}): { hydrated: Record<string, unknown>[]; unjudgedRows: number[] } {
  const unjudgedRows: number[] = [];
  const hydrated = rows.map((row, index) => {
    const next: Record<string, unknown> = { ...row };
    for (const entry of resolved) {
      const cell = cellFor({ row, entry, computed });
      if (isCancelled && cell === undefined && unjudgedRows.at(-1) !== index) {
        unjudgedRows.push(index);
      }
      next[entry.call.column] = cell?.value ?? null;
    }
    return next;
  });
  return { hydrated, unjudgedRows };
}

/** The computed value for one cell: null for a null key, undefined when the key was never answered. */
function cellFor({
  row,
  entry,
  computed,
}: {
  row: Record<string, unknown>;
  entry: ResolvedCall;
  computed: ComputedValues;
}): ComputedValue | null | undefined {
  const parts = appFunctionKeyParts(row[entry.call.column]);
  if (parts === null) return null;
  return computed.get(entry.call.column)?.get(appFunctionKeyId(parts));
}

function countWhere({
  computed,
  entry,
  predicate,
}: {
  computed: ComputedValues;
  entry: ResolvedCall;
  predicate: (value: ComputedValue) => boolean;
}): number {
  const perKey = computed.get(entry.call.column);
  if (!perKey) return 0;
  let count = 0;
  for (const value of perKey.values()) if (predicate(value)) count += 1;
  return count;
}

/**
 * Drops trailing rows past the hydrated-bytes ceiling.
 *
 * Trailing rather than largest-first: the caller wrote the `ORDER BY`, so the
 * rows that survive are a prefix of the answer they asked for, which is a
 * result they can page past. Dropping the biggest rows instead would hand back
 * a set with holes in it that nothing in the response could describe.
 */
function applyHydratedByteCeiling({
  rows,
  maxHydratedBytes,
}: {
  rows: readonly Record<string, unknown>[];
  maxHydratedBytes: number;
}): { rows: Record<string, unknown>[]; isTruncatedByBytes: boolean } {
  const encoder = new TextEncoder();
  const kept: Record<string, unknown>[] = [];
  let bytes = 0;
  for (const row of rows) {
    // Encoded length, not string length: a transcript in a non-Latin script
    // costs two to four bytes per code unit, and counting code units would let
    // such a result run several times past the ceiling it is here to hold.
    bytes += encoder.encode(JSON.stringify(row) ?? "").length;
    if (bytes > maxHydratedBytes) {
      return { rows: kept, isTruncatedByBytes: true };
    }
    kept.push(row);
  }
  return { rows: kept, isTruncatedByBytes: false };
}

/**
 * Re-declares each hydrated column with the type its value actually has.
 *
 * The server typed the column after the key — `Nullable(String)` for a
 * conversation id — and leaving that in place would tell a consumer the column
 * holds an id. A column the result did not carry at all is left alone rather
 * than invented: hydration describes what came back, and cannot add a column
 * the database never returned.
 */
function retypeColumns({
  columns,
  resolved,
}: {
  columns: readonly LangWatchQLColumn[];
  resolved: readonly ResolvedCall[];
}): readonly LangWatchQLColumn[] {
  const byColumn = new Map(
    resolved.map((entry) => [entry.call.column, entry.definition.returns]),
  );
  return columns.map((column) => {
    const type = byColumn.get(column.name);
    return type === undefined ? column : { ...column, type };
  });
}
