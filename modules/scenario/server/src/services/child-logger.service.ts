/**
 * Bridges parent's logger context (scenarioRunId, batchRunId, projectId, scenarioId)
 * to spawned child process. Without this, child logs aren't joinable by ID (lw#3593).
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
 * Encode a logger context for transport across a process boundary, as a
 * JSON string suitable for an env var. Keys whose value is `undefined` are
 * dropped so the child only inherits real bindings.
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
   * Decode an env var value into a logger context object. Returns an empty
   * object when unset or malformed, never throwing; malformed JSON warns on
   * stderr so it's still visible during incident response.
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
   * Build the base logger for a scenario child process: reads the context
   * env var, decodes it, and returns a child logger bound to those fields.
   * Call once at the top of `scenario-child-process.ts`.
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
