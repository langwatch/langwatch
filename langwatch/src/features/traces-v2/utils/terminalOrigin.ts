import { hasAnsi } from "./ansi/ansi";

/**
 * Signals that tell us a trace came from a coding agent running in a real
 * terminal — the cue to offer the Terminal view. These come off the trace /
 * span attributes at the wiring site (`service.name`, `langwatch.origin`, and
 * the `terminal.type` span attribute, e.g. `xterm-256color`).
 */
export interface TerminalOriginSignals {
  serviceName?: string | null;
  origin?: string | null;
  /** The `terminal.type` attribute, present only for real terminal sessions. */
  terminalType?: string | null;
}

/**
 * True when the trace looks like a coding-agent terminal session. Any one of:
 * the service is Claude Code, the origin is a coding agent, or a `terminal.type`
 * was reported at all (that attribute is only set by a terminal). Kept
 * permissive on purpose — the Terminal view degrades gracefully on non-ANSI
 * output, so a false positive just shows clean monospace text.
 */
export function isTerminalOrigin(signals: TerminalOriginSignals): boolean {
  const service = (signals.serviceName ?? "").toLowerCase();
  if (service.includes("claude-code") || service.includes("claude_code")) {
    return true;
  }
  if ((signals.origin ?? "") === "coding_agent") return true;
  const terminalType = (signals.terminalType ?? "").trim();
  if (terminalType.length > 0) return true;
  return false;
}

/** Re-exported so callers can cheaply test whether output carries ANSI codes. */
export { hasAnsi };
