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
}: {
  input: LangWatchQLHydrationInput;
  resolved: readonly ResolvedCall[];
  computed: ComputedValues;
  evalUsage?: LangWatchQLEvalUsage;
  timings?: LangWatchQLHydrationTimings;
}): LangWatchQLHydrationResult {
  const hydrated = input.rows.map((row) => {
    const next: Record<string, unknown> = { ...row };
    for (const entry of resolved) {
      const parts = appFunctionKeyParts(row[entry.call.column]);
      const value =
        parts === null
          ? null
          : (computed.get(entry.call.column)?.get(appFunctionKeyId(parts))
              ?.value ?? null);
      next[entry.call.column] = value;
    }
    return next;
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
  };
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
