import { type CodingAgentDefinition, signalSays } from "./coding-agent-definition";

/**
 * Claude Code (CLI). Namespaces its event and metric names under
 * `claude_code.`, with scope `com.anthropic.claude_code.events` — the bare
 * `anthropic` scope match catches records whose names arrive un-namespaced.
 *
 * Registered AFTER claude_cowork: Cowork runs this same runtime, so the
 * anthropic scope alone must not claim a record whose service says cowork.
 */
export const claudeCodeAgent: CodingAgentDefinition = {
  id: "claude_code",
  matches: (signal) => signalSays(signal, "claude_code") || signal.scope.includes("anthropic"),
  namePrefixes: ["claude_code."],
};
