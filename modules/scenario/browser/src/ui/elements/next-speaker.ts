/**
 * Who the drawer is waiting for, read from the conversation so far.
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 */

import { isTerminalStatus, type ScenarioRunStatus } from "@langwatch/scenario-contract";

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
