/**
 * What the hydration stage is given and what it answers with.
 *
 * Its own module because every step of the stage reads part of it and the
 * orchestration in `../hydrate.ts` reads all of it: keeping the shapes beside
 * the entry point would make each step import the step that calls it.
 *
 * @see ../hydrate.ts
 */

import type { InstantEvalClassifier } from "~/server/app-layer/instant-evals/classifier/classifier";
import type { Protections } from "~/server/traces/protections";
import type { LangWatchQLColumn } from "../../executor";
import type {
  LangWatchQLAppFunctionDefinition,
  LangWatchQLAppFunctionKeyKind,
} from "../catalog";
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
  /**
   * The judge behind an eval function, and the ceilings on using it.
   *
   * Absent when the statement calls no eval function, which is every
   * LangWatchQL query that existed before Instant Evals.
   */
  readonly instantEvals?: InstantEvalHydrationSupport;
  /**
   * The caller's cancellation, where the surface has one.
   *
   * A judged query is the one LangWatchQL shape that keeps spending after the
   * caller has gone: a thousand classifications outlive the HTTP request that
   * asked for them. So the signal is threaded all the way to the classifier,
   * and an abort stops the run rather than being counted as a row that could
   * not be judged.
   */
  readonly signal?: AbortSignal;
}

/** What the eval half of a hydration run is allowed to do. */
export interface InstantEvalHydrationSupport {
  readonly classifier: InstantEvalClassifier;
  /** Classifications in flight at once, across the whole query. */
  readonly maxConcurrency: number;
  /** Input tokens one synchronous query may send, before it is refused. */
  readonly queryTokenBudget: number;
}

/** What the eval half of a hydration run spent. */
export interface LangWatchQLEvalUsage {
  /** Classifications made, which is one per distinct text. */
  readonly requests: number;
  readonly inputTokens: number;
  /** Distinct texts that came back unjudged, by why. */
  readonly skipped: Readonly<Record<string, number>>;
}

export interface LangWatchQLHydrationResult {
  readonly columns: readonly LangWatchQLColumn[];
  readonly rows: readonly Record<string, unknown>[];
  /** Whether the hydrated-bytes ceiling dropped trailing rows. */
  readonly isTruncatedByBytes: boolean;
  readonly valueTruncations: readonly LangWatchQLValueTruncation[];
  readonly unresolvedKeys: readonly LangWatchQLUnresolvedKeys[];
  /** Present only when the statement called an eval function. */
  readonly evalUsage?: LangWatchQLEvalUsage;
}

/** A call, with the catalog entry it names. */
export interface ResolvedCall {
  readonly call: LangWatchQLAppFunctionCall;
  readonly definition: LangWatchQLAppFunctionDefinition;
  /**
   * The extraction this call judges, for an eval function written over one.
   *
   * When it is present, the key in the column belongs to *this* function, not
   * to the eval — the database's two identity UDFs left the inner one's key
   * there — so the read, the cap and the computed text all follow it.
   */
  readonly source?: LangWatchQLAppFunctionDefinition;
  /** The source's kind where there is one, otherwise the definition's own. */
  readonly keyKind: LangWatchQLAppFunctionKeyKind;
  /** Distinct keys this call needs, keyed by {@link appFunctionKeyId}. */
  readonly keys: Map<string, readonly string[]>;
}

/** One computed value, and whether the per-value ceiling cut it. */
export interface ComputedValue {
  /** A number for a judged column, text or a list for an extracted one. */
  readonly value: string | number | readonly string[] | null;
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
