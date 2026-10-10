import type { FoldProjectionStore } from "@langwatch/eventing";

/** The spend fold's read-through cache in front of its ledger (ADR-066). */
export interface GatewaySpendFoldCacheRepository {
  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State>;
}
