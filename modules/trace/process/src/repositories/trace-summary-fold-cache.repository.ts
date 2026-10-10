import type { FoldProjectionStore } from "@langwatch/eventing";

/** The trace summary fold's read-through cache in front of its durable store (ADR-066). */
export interface TraceSummaryFoldCacheRepository {
  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State>;
}
