import type { Named } from "@langwatch/module";
import { z } from "zod";

const startSuiteRunCommandDataSchemaDefinition = z.object({
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
export interface StartSuiteRunCommandDataSchema extends Named<
  typeof startSuiteRunCommandDataSchemaDefinition
> {}
export const startSuiteRunCommandDataSchema: StartSuiteRunCommandDataSchema =
  startSuiteRunCommandDataSchemaDefinition;
export type StartSuiteRunCommandData = z.infer<typeof startSuiteRunCommandDataSchema>;

const recordSuiteRunItemStartedCommandDataSchemaDefinition = z.object({
  tenantId: z.string(),
  batchRunId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  occurredAt: z.number(),
});
export interface RecordSuiteRunItemStartedCommandDataSchema extends Named<
  typeof recordSuiteRunItemStartedCommandDataSchemaDefinition
> {}
export const recordSuiteRunItemStartedCommandDataSchema: RecordSuiteRunItemStartedCommandDataSchema =
  recordSuiteRunItemStartedCommandDataSchemaDefinition;
export type RecordSuiteRunItemStartedCommandData = z.infer<
  typeof recordSuiteRunItemStartedCommandDataSchema
>;

const completeSuiteRunItemCommandDataSchemaDefinition = z.object({
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
export interface CompleteSuiteRunItemCommandDataSchema extends Named<
  typeof completeSuiteRunItemCommandDataSchemaDefinition
> {}
export const completeSuiteRunItemCommandDataSchema: CompleteSuiteRunItemCommandDataSchema =
  completeSuiteRunItemCommandDataSchemaDefinition;
export type CompleteSuiteRunItemCommandData = z.infer<typeof completeSuiteRunItemCommandDataSchema>;

const regradeSuiteRunItemCommandDataSchemaDefinition = z.object({
  tenantId: z.string(),
  batchRunId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  previousStatus: z.string(),
  previousVerdict: z.string().optional(),
  status: z.string(),
  verdict: z.string().optional(),
  idempotencyKey: z.string(),
  occurredAt: z.number(),
});
export interface RegradeSuiteRunItemCommandDataSchema extends Named<
  typeof regradeSuiteRunItemCommandDataSchemaDefinition
> {}
export const regradeSuiteRunItemCommandDataSchema: RegradeSuiteRunItemCommandDataSchema =
  regradeSuiteRunItemCommandDataSchemaDefinition;
export type RegradeSuiteRunItemCommandData = z.infer<typeof regradeSuiteRunItemCommandDataSchema>;
