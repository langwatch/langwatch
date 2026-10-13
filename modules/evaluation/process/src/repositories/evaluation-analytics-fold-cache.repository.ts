import type { FoldProjectionStore } from "@langwatch/eventing";

/** The analytics fold's read-through cache in front of its durable store (ADR-066). */
export interface EvaluationAnalyticsFoldCacheRepository {
  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State>;
}
