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
