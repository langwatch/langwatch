import { type CodingAgentDefinition, signalSays } from "./coding-agent-definition";

/**
 * Claude Cowork — the Claude desktop runtime working in a VM. Its telemetry
 * is Claude Code's event vocabulary (same events, same content-capture
 * knobs, `session.id` on every record), so nothing about the NAMES
 * distinguishes it; the SERVICE identity does: it exports with
 * `service.name: cowork` (and `terminal.type: non-interactive` on events).
 *
 * Registered FIRST — before claude_code — because its scope may say
 * anthropic and its event names may carry the `claude_code.` namespace;
 * the more specific service signal must win.
 */
export const claudeCoworkAgent: CodingAgentDefinition = {
  id: "claude_cowork",
  matches: (signal) => signalSays(signal, "cowork"),
  namePrefixes: ["claude_cowork.", "cowork."],
  // Cowork exports events over the logs protocol; spans only via a beta
  // flag. The session fold folds its model calls and tool runs from events.
  logsOnly: true,
};
