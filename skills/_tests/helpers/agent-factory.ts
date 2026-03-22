import type { AgentAdapter } from "@langwatch/scenario";
import type { AgentRunner, RunnerOptions } from "./types.js";
import { ClaudeCodeRunner } from "./runners/claude-code.js";
import { CodexRunner } from "./runners/codex.js";
import { CursorRunner } from "./runners/cursor.js";

const RUNNERS: Record<string, () => AgentRunner> = {
  "claude-code": () => new ClaudeCodeRunner(),
  codex: () => new CodexRunner(),
  cursor: () => new CursorRunner(),
};

/**
 * Returns the runner matching the `AGENT_UNDER_TEST` environment variable.
 *
 * Defaults to "claude-code" when the variable is not set.
 * Throws for unrecognized values.
 */
export function getRunner(): AgentRunner {
  const agent = process.env.AGENT_UNDER_TEST || "claude-code";
  const factory = RUNNERS[agent];

  if (!factory) {
    const known = Object.keys(RUNNERS).join(", ");
    throw new Error(
      `Unknown agent "${agent}". Set AGENT_UNDER_TEST to one of: ${known}`
    );
  }

  return factory();
}

/**
 * Create an AgentAdapter for the active runner.
 *
 * Reads `AGENT_UNDER_TEST` env var (default: "claude-code") and delegates
 * to the matching runner's `createAgent()` method.
 */
export function createAgent(options: RunnerOptions): AgentAdapter {
  const runner = getRunner();
  return runner.createAgent(options);
}
