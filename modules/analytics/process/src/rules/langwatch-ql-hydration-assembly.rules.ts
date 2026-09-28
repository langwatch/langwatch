/**
 * The last step of the hydration stage: the values in their cells, the ceiling
 * on the rows, and the types the columns are re-declared with.
 * @see specs/lwql/app-functions.feature
 */

import type { LangWatchQLColumn } from "@langwatch/analytics-contract";
import { cutToEstimatedTokensKeepingEnds } from "@langwatch/trace-contract";

import {
  appFunctionKeyId,
  findAppFunctionKeyParts,
} from "./langwatch-ql-app-function-keys.rules.ts";
import type {
  LangWatchQLComputedValue,
  LangWatchQLComputedValues,
  LangWatchQLResolvedCall,
} from "./langwatch-ql-hydration-plan.rules.ts";

/** How much hydrated content one response may carry. */
export interface LangWatchQLHydrationLimits {
  /**
   * Byte budget for the whole hydrated result — separate from the executor's
   * own, which bounded the page of keys the database returned. This bounds
   * what the application then put in them.
   */
  readonly maxHydratedBytes: number;
  /**
   * Byte ceiling for one value, cut on a UTF-8 boundary and reported: one
   * enormous trace in a page of a hundred costs that cell, not the other
   * ninety-nine rows.
   */
  readonly maxHydratedValueBytes: number;
  /**
   * Byte budget for the trace reads themselves. Past it the read stops and the
   * query is refused, because a result cut down afterwards would already have
   * held every trace in memory.
   */
  readonly maxReadBytes: number;
}

/** The shipped hydration ceilings. */
export const DEFAULT_LWQL_HYDRATION_LIMITS: LangWatchQLHydrationLimits = {
  maxHydratedBytes: 32_000_000,
  maxHydratedValueBytes: 4_000_000,
  maxReadBytes: 128_000_000,
};

/** One call's values that were cut at the per-value ceiling. */
export interface LangWatchQLValueTruncation {
  readonly column: string;
  readonly function: string;
  readonly values: number;
}

/** One call's keys that named nothing. */
export interface LangWatchQLUnresolvedKeys {
  readonly column: string;
  readonly function: string;
  readonly keys: number;
}

export interface LangWatchQLHydrationResult {
  readonly columns: readonly LangWatchQLColumn[];
  readonly rows: readonly Record<string, unknown>[];
  /** Whether the hydrated-bytes ceiling dropped trailing rows. */
  readonly isTruncatedByBytes: boolean;
  readonly valueTruncations: readonly LangWatchQLValueTruncation[];
  readonly unresolvedKeys: readonly LangWatchQLUnresolvedKeys[];
}

/**
 * Cuts one value to the per-value ceiling. Only a string is cut: the one
 * list-valued function is bounded by the thread read itself. The cut keeps both
 * ends at a quarter of the byte budget, on UTF-8 boundaries.
 */
export function capLangWatchQLValue({
  computed,
  maxBytes,
}: {
  computed: LangWatchQLComputedValue;
  maxBytes: number;
}): LangWatchQLComputedValue {
  const { value } = computed;
  if (typeof value !== "string") return computed;
  if (new TextEncoder().encode(value).length <= maxBytes) return computed;

  return {
    ...computed,
    value: cutToEstimatedTokensKeepingEnds({ text: value, maxTokens: Math.floor(maxBytes / 4) }),
    isTruncated: true,
  };
}

function countWhere({
  computed,
  entry,
  predicate,
}: {
  computed: LangWatchQLComputedValues;
  entry: LangWatchQLResolvedCall;
  predicate: (value: LangWatchQLComputedValue) => boolean;
}): number {
  const perKey = computed.get(entry.call.column);
  if (!perKey) return 0;
  let count = 0;
  for (const value of perKey.values()) if (predicate(value)) count += 1;

  return count;
}

/**
 * Drops trailing rows past the hydrated-bytes ceiling. Trailing rather than
 * largest-first: the caller wrote the ORDER BY, so what survives is a prefix
 * they can page past rather than a set with holes nothing can describe.
 */
function applyHydratedByteCeiling({
  rows,
  maxHydratedBytes,
}: {
  rows: readonly Record<string, unknown>[];
  maxHydratedBytes: number;
}): { rows: readonly Record<string, unknown>[]; isTruncatedByBytes: boolean } {
  const encoder = new TextEncoder();
  const kept: Record<string, unknown>[] = [];
  let bytes = 0;
  for (const row of rows) {
    // Encoded length, not string length: a transcript in a non-Latin script
    // costs two to four bytes per code unit.
    bytes += encoder.encode(JSON.stringify(row) ?? "").length;
    if (bytes > maxHydratedBytes) return { rows: kept, isTruncatedByBytes: true };
    kept.push(row);
  }

  return { rows: kept, isTruncatedByBytes: false };
}

/**
 * Re-declares each hydrated column with the type its value actually has: the
 * server typed it after the key. A column the result did not carry is left
 * alone — hydration describes what came back and cannot invent a column.
 */
function retypeColumns({
  columns,
  resolved,
}: {
  columns: readonly LangWatchQLColumn[];
  resolved: readonly LangWatchQLResolvedCall[];
}): readonly LangWatchQLColumn[] {
  const byColumn = new Map(resolved.map((entry) => [entry.call.column, entry.definition.returns]));

  return columns.map((column) => {
    const type = byColumn.get(column.name);
    return type === undefined ? column : { ...column, type };
  });
}

/** Puts every computed value in its cell; an unanswered key hydrates to null. */
function hydrateRows({
  rows,
  resolved,
  computed,
}: {
  rows: readonly Record<string, unknown>[];
  resolved: readonly LangWatchQLResolvedCall[];
  computed: LangWatchQLComputedValues;
}): readonly Record<string, unknown>[] {
  return rows.map((row) => {
    const next: Record<string, unknown> = { ...row };
    for (const entry of resolved) {
      // A null key hydrates to null without asking anything; a key the compute
      // never answered does too.
      const parts = findAppFunctionKeyParts(row[entry.call.column]);
      const cell =
        parts.length === 0
          ? undefined
          : computed.get(entry.call.column)?.get(appFunctionKeyId(parts));
      next[entry.call.column] = cell?.value ?? null;
    }
    return next;
  });
}

export function assembleLangWatchQLHydration({
  columns,
  rows,
  resolved,
  computed,
  limits,
}: {
  columns: readonly LangWatchQLColumn[];
  rows: readonly Record<string, unknown>[];
  resolved: readonly LangWatchQLResolvedCall[];
  computed: LangWatchQLComputedValues;
  limits: LangWatchQLHydrationLimits;
}): LangWatchQLHydrationResult {
  const ceiling = applyHydratedByteCeiling({
    rows: hydrateRows({ rows, resolved, computed }),
    maxHydratedBytes: limits.maxHydratedBytes,
  });

  return {
    columns: retypeColumns({ columns, resolved }),
    rows: ceiling.rows,
    isTruncatedByBytes: ceiling.isTruncatedByBytes,
    valueTruncations: resolved
      .map((entry) => ({
        column: entry.call.column,
        function: entry.definition.name,
        values: countWhere({ computed, entry, predicate: (value) => value.isTruncated }),
      }))
      .filter((report) => report.values > 0),
    unresolvedKeys: resolved
      .map((entry) => ({
        column: entry.call.column,
        function: entry.definition.name,
        keys: countWhere({ computed, entry, predicate: (value) => !value.isResolved }),
      }))
      .filter((report) => report.keys > 0),
  };
}
