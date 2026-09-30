/**
 * The ids every call to the app carries.
 *
 * The routes under `/api/langy/local` and `/api/langy/waits` take the
 * conversation and the turn in each request: the session key proves who the
 * caller is, the ids say where the card belongs. The conversation is fixed for
 * the life of the worker and arrives in the environment; the turn changes with
 * each turn command, so the runner writes it into a holder the tools read when
 * they call. The holder also carries the turn's settled calls, for a tool
 * whose answer depends on what ran before it in the same turn, and whether
 * the conversation is on the guided path, for the skill tool.
 */

/** A call of the turn that has settled, as the runner records it off pi's events. */
export type SettledCall = {
  name: string;
  input: unknown;
  isError: boolean;
  output: string;
};

export type TurnContext = {
  /** The turn in flight, or null between turns. */
  turnId: string | null;
  /** The settled calls of the turn in flight, in order; empty between turns. */
  calls: readonly SettledCall[];
  /**
   * The conversation is on the guided path: the turn in flight carries the
   * kickoff brief, in its message or in the seed of a resumed conversation,
   * or the transcript does. Read once per turn by the runner, before the
   * prompt goes out. False between turns.
   */
  guided: boolean;
};

export function createTurnContext(): TurnContext {
  return { turnId: null, calls: [], guided: false };
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
