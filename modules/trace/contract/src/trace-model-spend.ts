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
