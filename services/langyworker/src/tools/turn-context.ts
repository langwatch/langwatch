/**
 * The ids every call to the app carries.
 *
 * The routes under `/api/langy/local` and `/api/langy/waits` take the
 * conversation and the turn in each request: the session key proves who the
 * caller is, the ids say where the card belongs. The conversation is fixed for
 * the life of the worker and arrives in the environment; the turn changes with
 * each turn command, so the runner writes it into a holder the tools read when
 * they call.
 */

export type TurnContext = {
  /** The turn in flight, or null between turns. */
  turnId: string | null;
};

export function createTurnContext(): TurnContext {
  return { turnId: null };
}

/** The conversation this worker serves, as the manager named it at spawn. */
export function conversationId(): string {
  return process.env.LANGY_CONVERSATION_ID ?? "";
}

/** The ids a call body carries. An absent tool call id is left out. */
export function callIds({
  turnContext,
  toolCallId,
}: {
  turnContext: TurnContext;
  toolCallId?: string;
}): { conversationId: string; turnId: string; toolCallId?: string } {
  return {
    conversationId: conversationId(),
    turnId: turnContext.turnId ?? "",
    ...(toolCallId ? { toolCallId } : {}),
  };
}
