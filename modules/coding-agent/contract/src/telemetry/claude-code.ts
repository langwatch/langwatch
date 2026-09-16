import { type CodingAgentDefinition, signalSays } from "./coding-agent-definition.ts";

/**
 * Claude Code (CLI): namespaces under `claude_code.`, scope
 * `com.anthropic.claude_code.events` — the bare `anthropic` match catches
 * un-namespaced records. Registered AFTER claude_cowork, since cowork shares this runtime.
 */
export const claudeCodeAgent: CodingAgentDefinition = {
  id: "claude_code",
  matches: (signal) => signalSays(signal, "claude_code") || signal.scope.includes("anthropic"),
  namePrefixes: ["claude_code."],
};
