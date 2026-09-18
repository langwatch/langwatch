/**
 * What the hydration stage is given and what it answers with.
 *
 * Its own module because every step of the stage reads part of it and the
 * orchestration in `../hydrate.ts` reads all of it: keeping the shapes beside
 * the entry point would make each step import the step that calls it.
 *
 * @see ../hydrate.ts
 */

import type { Protections } from "~/server/traces/protections";
import type { LangWatchQLColumn } from "../../executor";
import type { LangWatchQLAppFunctionDefinition } from "../catalog";
import type { LangWatchQLAppFunctionCall } from "../plan";
import type { LangWatchQLAppFunctionTraceSource } from "../traceSource";

/** How much hydrated content one response may carry. */
export interface LangWatchQLHydrationLimits {
  /**
   * Byte budget for the whole hydrated result. Trailing rows are dropped past
   * it and the result says so.
   *
   * Separate from the executor's `maxResultBytes`, which bounded the rows the
   * *database* returned — a page of keys, which is small by construction. This
   * bounds what the application then put in them, which is the number that can
   * run to megabytes per row.
   */
  readonly maxHydratedBytes: number;
  /**
   * Byte ceiling for one value. A value past it is cut on a UTF-8 boundary and
   * reported, rather than the whole row being dropped: one enormous trace in a
   * page of a hundred should cost that one cell, not the ninety-nine others.
   */
  readonly maxHydratedValueBytes: number;
}

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

export interface LangWatchQLHydrationInput {
  /**
   * The projects this key can read, which is what the trace reads filter on.
   *
   * A list rather than one id because a key with access to several projects
   * gets the union of their rows unless the query narrows to one, so the keys
   * a result carries can name traces in any of them.
   */
  readonly projectIds: readonly string[];
  /** Resolved server-side from the authenticated context, never the request. */
  readonly protections: Protections;
  /** The plan the validator's walk recorded. Empty means nothing to do. */
  readonly calls: readonly LangWatchQLAppFunctionCall[];
  readonly columns: readonly LangWatchQLColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly limits: LangWatchQLHydrationLimits;
  readonly traceSource: LangWatchQLAppFunctionTraceSource;
}

export interface LangWatchQLHydrationResult {
  readonly columns: readonly LangWatchQLColumn[];
  readonly rows: readonly Record<string, unknown>[];
  /** Whether the hydrated-bytes ceiling dropped trailing rows. */
  readonly isTruncatedByBytes: boolean;
  readonly valueTruncations: readonly LangWatchQLValueTruncation[];
  readonly unresolvedKeys: readonly LangWatchQLUnresolvedKeys[];
}

/** A call, with the catalog entry it names. */
export interface ResolvedCall {
  readonly call: LangWatchQLAppFunctionCall;
  readonly definition: LangWatchQLAppFunctionDefinition;
  /** Distinct keys this call needs, keyed by {@link appFunctionKeyId}. */
  readonly keys: Map<string, readonly string[]>;
}

/** One computed value, and whether the per-value ceiling cut it. */
export interface ComputedValue {
  readonly value: string | readonly string[] | null;
  readonly isTruncated: boolean;
  /** False when the key named no trace, thread or span at all. */
  readonly isResolved: boolean;
}

export const NOT_RESOLVED: ComputedValue = {
  value: null,
  isTruncated: false,
  isResolved: false,
};

/** Every call's values, by output column and then by key id. */
export type ComputedValues = ReadonlyMap<
  string,
  ReadonlyMap<string, ComputedValue>
>;
