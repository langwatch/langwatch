/** Epoch milliseconds, start inclusive and end exclusive. */
export interface GatewayPrincipalSpendWindow {
  readonly startMs: number;
  readonly endMs: number;
}

/** One user's principal-scope ledger spend in a window, one row per gateway request. */
export interface GatewayPrincipalSpendSummary {
  readonly totalCost: number;
  readonly requestCount: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly topModel: { readonly name: string; readonly requests: number } | null;
}

/** One UTC day's principal-scope ledger spend; ledger spend is real spend, so fully billed. */
export interface GatewayPrincipalDailySpend {
  readonly day: string;
  readonly spentUsd: number;
  readonly billedUsd: number;
  readonly requests: number;
}

/** One model's principal-scope ledger spend; ledger spend is real spend, so fully billed. */
export interface GatewayPrincipalModelSpend {
  readonly label: string;
  readonly spentUsd: number;
  readonly billedUsd: number;
  readonly requests: number;
}
