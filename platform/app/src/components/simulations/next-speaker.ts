/**
 * Who the drawer is waiting for, read from the conversation so far.
 *
 * A run alternates between the simulated user and the agent under test, and
 * the judge reads the conversation after every agent message. So the last
 * message says what comes next: after a user message the agent answers, and
 * after an agent message the judge speaks, which may end the run. The judge
 * is not drawn as a message, so a run waiting on it has no next speaker.
 *
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 */

import {
  isTerminalStatus,
  type ScenarioRunStatus,
} from "~/server/scenarios/scenario-event.enums";

/** The role of the message the run is waiting for, or none. */
export type NextSpeaker = "user" | "assistant" | null;

type TurnMessage = {
  role?: string | null;
  tool_calls?: unknown;
  toolCalls?: unknown;
};

export function nextSpeakerOf({
  messages,
  streamingMessages,
  status,
}: {
  messages: TurnMessage[];
  streamingMessages?: TurnMessage[];
  status: ScenarioRunStatus;
}): NextSpeaker {
  if (isTerminalStatus(status)) return null;

  const spoken = [...messages, ...(streamingMessages ?? [])];
  const last = spoken[spoken.length - 1];

  // The simulated user opens the conversation, unless a script wrote its
  // first line, in which case the message is already there.
  if (!last) return "user";
  if (last.role === "user") return "assistant";

  // A tool call and its result are the agent working through its own turn,
  // so the answer is still on its way.
  const callsTools = hasToolCalls(last);
  if (last.role === "tool" || callsTools) return "assistant";

  return null;
}

function hasToolCalls(message: TurnMessage): boolean {
  const calls = message.tool_calls ?? message.toolCalls;
  return Array.isArray(calls) && calls.length > 0;
}
