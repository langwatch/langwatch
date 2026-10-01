import { type CodingAgentDefinition, signalSays } from "./coding-agent-definition.ts";

// Codex (record NAME is signal). Splits exporters by signal; session_task.turn
// span carries tokens; tool runs fold from events; code mode wraps real tools;
// costs priced from tokens only.
export const codexAgent: CodingAgentDefinition = {
  id: "codex",
  matches: (signal) => signalSays(signal, "codex"),
  namePrefixes: ["codex."],

  // `turn/start` is a helper thread's app-server request span, admitted at ingestion only once
  // it carries the helper's thread id under `langwatch.thread.id`.
  sessionSpanNames: ["session_task.turn", "turn/start"],
  foldsToolRunsFromEvents: true,
  wrapperToolNames: ["exec"],
  logsRequireSessionKey: true,

  // The turn span carries TWO ids, live-verified on 0.147: `thread.id` is
  // the session (same as every log event's `conversation.id`), while
  // `gen_ai.conversation.id` is the TURN's — reading the latter via the
  // shared order would split turns into their own sessions. Guarded to
  // UUID shape since codex's OTHER spans stamp tokio worker id "10" here too.
  deriveSessionKeyFromSpan: ({ name, attrs }) => {
    // The helper's request span names its thread only through the ingestion stamp; its own
    // `thread.id` is a tokio worker id.
    let threadId: unknown = null;
    if (name === "turn/start") threadId = attrs["langwatch.thread.id"];
    else if (name === "session_task.turn") threadId = attrs["thread.id"];
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
