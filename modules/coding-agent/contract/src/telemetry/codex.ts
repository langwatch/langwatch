import { type CodingAgentDefinition, signalSays } from "./coding-agent-definition.ts";

// Codex (record NAME is signal). Splits exporters by signal; session_task.turn
// span carries tokens; tool runs fold from events; code mode wraps real tools;
// costs priced from tokens only.
export const codexAgent: CodingAgentDefinition = {
  id: "codex",
  matches: (signal) => signalSays(signal, "codex"),
  namePrefixes: ["codex."],

  sessionSpanNames: ["session_task.turn"],
  foldsToolRunsFromEvents: true,
  wrapperToolNames: ["exec"],
  logsRequireSessionKey: true,

  // The turn span carries TWO ids, live-verified on 0.147: `thread.id` is
  // the session (equal to the `conversation.id` every codex log event
  // carries), while `gen_ai.conversation.id` is the id of the TURN — the
  // shared candidate order would read the latter and split each turn into
  // its own session. Guarded to UUID-shaped values because codex's OTHER
  // spans stamp the tokio worker id ("10") under the same key; those spans
  // are not gated in, but the guard keeps this hook safe if one ever is.
  sessionKeyFromSpan: ({ name, attrs }) => {
    if (name !== "session_task.turn") return null;
    const threadId = attrs["thread.id"];
    return typeof threadId === "string" && threadId.includes("-") ? threadId : null;
  },

  eventAliases: {
    // Codex reports TTFT as its own event rather than a span attribute.
    turn_ttft: "turn_ttft",
  },

  metricAliases: {
    // Codex spells its token metric differently, and reports it per turn.
    "turn.token_usage": "token_usage",
  },
};
