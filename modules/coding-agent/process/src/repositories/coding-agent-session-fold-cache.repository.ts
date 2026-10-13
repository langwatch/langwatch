import type { FoldProjectionStore } from "@langwatch/eventing";

/** The session fold's read-through cache in front of its durable store (ADR-056). */
export interface CodingAgentSessionFoldCacheRepository {
  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State>;
}
