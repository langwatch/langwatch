/**
 * Decides whether the Langy panel should re-hydrate its useChat engine from the
 * durable `langy.messages` fold.
 *
 * The rendered thread IS the engine, and it is normally hydrated only on an
 * explicit user selection so a background refetch can never clobber a live
 * in-flight stream. That leaves a gap: a turn this client did NOT drive (another
 * tab, a recovered/again-driven turn, a programmatic caller) grows the durable
 * fold — via the id-only freshness signal that invalidates `langy.messages` —
 * but nothing pushes that growth into the engine, so the open thread stays stale
 * until a remount.
 *
 * This predicate closes that gap safely. It returns true only when it is certain
 * the engine is NOT owned by the live path and the durable fold genuinely has
 * more to show:
 *   - a pending user selection owns the engine — that effect will apply it;
 *   - a live self-driven turn (submitted/streaming) owns the engine;
 *   - a refetch in flight — wait for it to settle before comparing;
 *   - AHEAD-ONLY: apply only when durable has more messages than the engine,
 *     never shrinking it. A momentarily-stale refetch at a turn's settle
 *     boundary would otherwise flash the pre-answer history.
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
