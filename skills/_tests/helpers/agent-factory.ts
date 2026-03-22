import type { AgentAdapter } from "@langwatch/scenario";
import type { AgentRunner, RunnerOptions } from "./types.js";
import { ClaudeCodeRunner } from "./runners/claude-code.js";
import { CodexRunner } from "./runners/codex.js";

const VALID_RUNNERS = ["claude-code", "codex"] as const;
type RunnerName = (typeof VALID_RUNNERS)[number];

const runnerFactories: Record<RunnerName, () => AgentRunner> = {
  "claude-code": () => new ClaudeCodeRunner(),
  codex: () => new CodexRunner(),
};

let cachedRunner: AgentRunner | undefined;
let cachedRunnerEnv: string | undefined;

/**
 * Returns the active AgentRunner based on the AGENT_UNDER_TEST env var.
 *
 * Defaults to "claude-code" when the env var is not set.
 * Throws with a descriptive error listing valid names if the value is unknown.
 */
export function getRunner(): AgentRunner {
  const envValue = process.env.AGENT_UNDER_TEST ?? "claude-code";

  // Cache the runner to avoid re-resolving binaries on every call
  if (cachedRunner && cachedRunnerEnv === envValue) {
    return cachedRunner;
  }

  if (!VALID_RUNNERS.includes(envValue as RunnerName)) {
    throw new Error(
      `Unknown AGENT_UNDER_TEST value: "${envValue}". Valid values are: ${VALID_RUNNERS.join(", ")}`
    );
  }

  const factory = runnerFactories[envValue as RunnerName];
  if (!factory) {
    throw new Error(
      `No runner factory for "${envValue}". Valid values are: ${VALID_RUNNERS.join(", ")}`
    );
  }

  cachedRunner = factory();
  cachedRunnerEnv = envValue;
  return cachedRunner;
}

/**
 * Creates an AgentAdapter using the active runner.
 *
 * Convenience wrapper: equivalent to `getRunner().createAgent(options)`.
 */
export function createAgent(options: RunnerOptions): AgentAdapter {
  return getRunner().createAgent(options);
}

/**
 * Check whether the active runner's binary is available.
 *
 * Use this to skip the entire test suite gracefully when the selected
 * runner is not installed.
 */
export function isRunnerAvailable(): boolean {
  try {
    const runner = getRunner();
    // Duck-type check for isBinaryAvailable method
    if ("isBinaryAvailable" in runner && typeof (runner as any).isBinaryAvailable === "function") {
      return (runner as any).isBinaryAvailable();
    }
    return true;
  } catch {
    return false;
  }
}
