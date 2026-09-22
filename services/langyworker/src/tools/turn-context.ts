/**
 * The ids every call to the app carries: the conversation (fixed for the
 * worker's life) and the turn (written by the runner per turn command).
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
   * The conversation is on the guided path (the kickoff brief is in the
   * turn's message, its resume seed, or the transcript). Read once per turn
   * before the prompt goes out; false between turns.
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
