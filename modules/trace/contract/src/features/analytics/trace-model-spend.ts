/**
 * Spend per model over one project's traces in a window, most spent first. A multi-model trace
 * counts its whole cost toward each model it used. Main's personal-usage `breakdownByModel`.
 */
export interface TraceModelSpend {
  readonly label: string;
  readonly spentUsd: number;
  readonly billedUsd: number;
  readonly requests: number;
}

/** Epoch milliseconds, start inclusive and end exclusive. */
export interface TraceModelSpendWindow {
  readonly startMs: number;
  readonly endMs: number;
}

/** One project's deduped spend and token totals over a window; zeros when it has no traces. */
export interface TraceSpendSummary {
  readonly totalCost: number;
  readonly billedCost: number;
  readonly requestCount: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/** Traces per model in a window; a multi-model trace counts once toward each model it used. */
export interface TraceModelRequests {
  readonly model: string;
  readonly requests: number;
}

/** One UTC day's spend (`YYYY-MM-DD`), present only for days carrying traces. */
export interface TraceDailySpend {
  readonly day: string;
  readonly spentUsd: number;
  readonly billedUsd: number;
  readonly requests: number;
}

/** A trace attribute and the value it must hold. */
export interface TraceAttributeMatch {
  readonly key: string;
  readonly value: string;
}

/** Spend of the traces whose attribute holds `value`, deduped per trace; `spentUsd` is decimal. */
export interface TraceAttributeValueSpend {
  readonly value: string;
  readonly spentUsd: string;
  readonly requests: number;
}

/** One (attribute value, first model or "unknown", UTC day) slice of deduped traces. */
export interface TraceAttributeUsageBucket {
  readonly value: string;
  readonly model: string;
  readonly day: string;
  readonly totalUsd: string;
  readonly requests: number;
  readonly blockedRequests: number;
}

/** One deduped trace carrying the attribute, as the latest version reads. */
export interface TraceAttributedTrace {
  readonly traceId: string;
  readonly value: string;
  readonly costUsd: string;
  readonly models: readonly string[];
  readonly occurredAtMs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly durationMs: number;
  readonly hasError: boolean;
  readonly blockedByGuardrail: boolean;
}

/** Spend sort keys an attributed read orders by; the store maps each to its own expression. */
export type TraceAttributedSpendSort = "spend" | "requests" | "lastActivity";

/** Totals of the traces matching every attribute: current and previous window, distinct actors. */
export interface TraceAttributedSpendComparison {
  readonly currentSpendUsd: number;
  readonly previousSpendUsd: number;
  readonly currentActors: number;
}

/** One attribute value's spend in a window; `firstModel` is any trace's first model, or "". */
export interface TraceAttributedValueSpend {
  readonly value: string;
  readonly spentUsd: string;
  readonly requests: number;
  readonly lastOccurredAtMs: number;
  readonly firstModel: string;
}

/** One attribute value's spend split at the current window's start. */
export interface TraceAttributedValueComparison {
  readonly value: string;
  readonly currentSpendUsd: string;
  readonly previousSpendUsd: string;
  readonly currentRequests: number;
  readonly lastCurrentOccurredAtMs: number;
}

/** One (project, attribute value) slice of an organisation's spend; "" is a trace without it. */
export interface TraceProjectValueSpend {
  readonly projectId: string;
  readonly value: string;
  readonly spentUsd: string;
  readonly requests: number;
  readonly lastOccurredAtMs: number;
}

/** What a daily attributed read groups by: an attribute's value, or the trace's first model. */
export type TraceDailySpendGroup =
  | { readonly kind: "attribute"; readonly key: string }
  | { readonly kind: "firstModel" };

/** One UTC day's spend (`dayStartMs`) for one group value. */
export interface TraceDailyGroupSpend {
  readonly dayStartMs: number;
  readonly value: string | null;
  readonly spentUsd: string;
}

/** One attributed trace as its latest version reads; `attributes` holds only the asked keys. */
export interface TraceAttributedTraceDetail {
  readonly traceId: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly firstModel: string;
  readonly costUsd: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly occurredAtMs: number;
  readonly createdAtMs: number;
}

/** Trace counts since each asked moment, in order, and the newest occurrence (0 when none). */
export interface TraceAttributedRecency {
  readonly counts: readonly number[];
  readonly lastOccurredAtMs: number;
}
