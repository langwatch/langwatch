import type { FoldProjectionStore } from "@langwatch/eventing";

/** The trace analytics fold's read-through cache in front of its durable store (ADR-066). */
export interface TraceAnalyticsFoldCacheRepository {
  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State>;
}
