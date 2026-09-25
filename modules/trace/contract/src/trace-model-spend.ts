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
