import { z } from "zod";
import { suiteTargetSchema } from "./shared";

export const startSuiteRunCommandDataSchema = z.object({
  tenantId: z.string(),
  suiteId: z.string(),
  batchRunId: z.string(),
  setId: z.string(),
  total: z.number().int().nonnegative(),
  scenarioIds: z.array(z.string()),
  targets: z.array(suiteTargetSchema),
  repeatCount: z.number().int().positive(),
  idempotencyKey: z.string().optional(),
  occurredAt: z.number(),
});
export type StartSuiteRunCommandData = z.infer<typeof startSuiteRunCommandDataSchema>;

export const startScenarioCommandDataSchema = z.object({
  tenantId: z.string(),
  suiteId: z.string(),
  batchRunId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  targetReferenceId: z.string(),
  targetType: z.string(),
  occurredAt: z.number(),
});
export type StartScenarioCommandData = z.infer<typeof startScenarioCommandDataSchema>;

export const recordScenarioResultCommandDataSchema = z.object({
  tenantId: z.string(),
  suiteId: z.string(),
  batchRunId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  targetReferenceId: z.string(),
  targetType: z.string(),
  status: z.string(),
  verdict: z.string().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  occurredAt: z.number(),
});
export type RecordScenarioResultCommandData = z.infer<typeof recordScenarioResultCommandDataSchema>;
