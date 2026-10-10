/**
 * Bridges parent's logger context (scenarioRunId, batchRunId, projectId, scenarioId)
 * to spawned child process. Without this, child logs aren't joinable by ID (lw#3593).
 * The child reads it back in apps/scenario-child/src/config.ts.
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

export const SCENARIO_LOG_CONTEXT_ENV = "LANGWATCH_LOG_CONTEXT";

const scenarioLogContextSchemaDefinition = z.object({
  scenarioRunId: z.string().optional(),
  batchRunId: z.string().optional(),
  projectId: z.string().optional(),
  scenarioId: z.string().optional(),
  setId: z.string().optional(),
});
export interface ScenarioLogContextSchema extends Named<
  typeof scenarioLogContextSchemaDefinition
> {}
export const scenarioLogContextSchema: ScenarioLogContextSchema =
  scenarioLogContextSchemaDefinition;
export type ScenarioLogContext = z.infer<typeof scenarioLogContextSchema>;

/**
 * Encode a logger context for transport across a process boundary, as a
 * JSON string suitable for an env var. Keys whose value is `undefined` are
 * dropped so the child only inherits real bindings.
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
