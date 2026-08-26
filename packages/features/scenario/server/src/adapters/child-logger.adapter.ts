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

import { createLogger, type Logger } from "@langwatch/observability";
import { z } from "zod";

export const SCENARIO_LOG_CONTEXT_ENV = "LANGWATCH_LOG_CONTEXT";

export type ScenarioLogContext = {
  scenarioRunId?: string;
  batchRunId?: string;
  projectId?: string;
  scenarioId?: string;
  setId?: string;
};

const scenarioLogContextSchema = z.object({
  scenarioRunId: z.string().optional(),
  batchRunId: z.string().optional(),
  projectId: z.string().optional(),
  scenarioId: z.string().optional(),
  setId: z.string().optional(),
});

/**
 * Encode a logger context for transport across a process boundary.
 *
 * Returns a JSON string suitable for an env var. Keys whose value is
 * `undefined` are dropped so the child only inherits real bindings.
 */
export class ChildLoggerAdapter {
  static create(): ChildLoggerAdapter {
    return new ChildLoggerAdapter();
  }

  private constructor() {}

  static encode(context: ScenarioLogContext): string {
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
  static decode(raw: string | undefined): ScenarioLogContext {
    if (!raw) {
      return {};
    }
    try {
      const parsed = scenarioLogContextSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : {};
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
  static createLogger(name: string, env: NodeJS.ProcessEnv): Logger {
    const context = ChildLoggerAdapter.decode(env[SCENARIO_LOG_CONTEXT_ENV]);
    const base = createLogger(name);
    if (Object.keys(context).length === 0) {
      return base;
    }
    return base.child(context);
  }
}

export const encodeScenarioLogContext = ChildLoggerAdapter.encode;
export const decodeScenarioLogContext = ChildLoggerAdapter.decode;
export const createChildProcessLogger = ChildLoggerAdapter.createLogger;
