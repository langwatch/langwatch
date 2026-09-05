/**
 * Decides whether the Langy panel should re-hydrate its useChat engine from the durable
 * `langy.messages` fold.
 */
export function shouldRehydrateEngineFromDurable(params: {
  /** A user selection/switch is loading — that effect owns the engine. */
  isHistoryLoadPending: boolean;
  /** A live self-driven turn (useChat submitted/streaming) owns the engine. */
  isStreaming: boolean;
  /** The durable messages query is mid-refetch; wait for fresh data. */
  isFetchingHistory: boolean;
  hasActiveConversation: boolean;
  /** user+assistant messages in the durable fold. */
  durableMessageCount: number;
  /** messages currently held by the useChat engine. */
  engineMessageCount: number;
}): boolean {
  if (params.isHistoryLoadPending) return false;
  if (params.isStreaming) return false;
  if (params.isFetchingHistory) return false;
  if (!params.hasActiveConversation) return false;
  return params.durableMessageCount > params.engineMessageCount;
}
