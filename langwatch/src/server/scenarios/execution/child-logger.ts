/**
 * Bridges the parent's structured logger context across the parent → child
 * process boundary.
 *
 * The parent attaches a context object (scenarioRunId, batchRunId, projectId,
 * scenarioId) to its `logger.child(...)` call. Without this bridge, the
 * spawned scenario child gets a fresh logger with no context, so its log
 * lines aren't joinable to the parent's by ID in CloudWatch Insights.
 *
 * Tracking: lw#3593.
 *
 * @see specs/scenarios/observability-context.feature
 */

import { createLogger, type Logger } from "~/utils/logger/server";

export const SCENARIO_LOG_CONTEXT_ENV = "LANGWATCH_LOG_CONTEXT";

export type ScenarioLogContext = {
  scenarioRunId?: string;
  batchRunId?: string;
  projectId?: string;
  scenarioId?: string;
  setId?: string;
};

/**
 * Encode a logger context for transport across a process boundary.
 *
 * Returns a JSON string suitable for an env var. Keys whose value is
 * `undefined` are dropped so the child only inherits real bindings.
 */
export function encodeScenarioLogContext(context: ScenarioLogContext): string {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === "string" && value.length > 0) {
      filtered[key] = value;
    }
  }
  return JSON.stringify(filtered);
}

/**
 * Decode an env var value into a logger context object.
 *
 * Returns an empty object when the env var is unset or malformed; never
 * throws. Malformed JSON triggers a stderr warning so it's still visible
 * during incident response.
 */
export function decodeScenarioLogContext(
  raw: string | undefined,
): ScenarioLogContext {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ScenarioLogContext;
    }
    return {};
  } catch {
    process.stderr.write(
      `[child-logger] ${SCENARIO_LOG_CONTEXT_ENV} is not valid JSON; ignoring\n`,
    );
    return {};
  }
}

/**
 * Build the base logger for a scenario child process.
 *
 * Reads the context env var, decodes it, and returns a child logger bound
 * to those fields. Use this once at the top of `scenario-child-process.ts`
 * and pass the returned logger down to anything emitting structured events.
 */
export function createChildProcessLogger(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Logger {
  const context = decodeScenarioLogContext(env[SCENARIO_LOG_CONTEXT_ENV]);
  const base = createLogger(name);
  if (Object.keys(context).length === 0) {
    return base;
  }
  return base.child(context);
}
