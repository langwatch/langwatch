import { z } from "zod";

export const startSuiteRunCommandDataSchema = z.object({
  tenantId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  suiteId: z.string(),
  total: z.number(),
  scenarioIds: z.array(z.string()),
  targetIds: z.array(z.string()),
  idempotencyKey: z.string(),
  occurredAt: z.number(),
});
export type StartSuiteRunCommandData = z.infer<typeof startSuiteRunCommandDataSchema>;

export const recordSuiteRunItemStartedCommandDataSchema = z.object({
  tenantId: z.string(),
  batchRunId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  occurredAt: z.number(),
});
export type RecordSuiteRunItemStartedCommandData = z.infer<typeof recordSuiteRunItemStartedCommandDataSchema>;

export const completeSuiteRunItemCommandDataSchema = z.object({
  tenantId: z.string(),
  batchRunId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  status: z.string(),
  verdict: z.string().optional(),
  durationMs: z.number().optional(),
  reasoning: z.string().optional(),
  error: z.string().optional(),
  occurredAt: z.number(),
});
export type CompleteSuiteRunItemCommandData = z.infer<typeof completeSuiteRunItemCommandDataSchema>;
