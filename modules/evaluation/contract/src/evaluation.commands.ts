import { z } from "zod";

export const executeEvaluationCommandSchema = z.object({
  projectId: z.string(),
  traceId: z.string(),
  evaluatorType: z.string(),
  settings: z.union([
    z.record(z.string(), z.unknown()),
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
  ]),
  mappings: z.record(z.string(), z.unknown()).nullable(),
  level: z.enum(["trace", "thread"]).optional(),
  workflowId: z.string().nullable().optional(),
  idempotencyKey: z.string().optional(),
});

export const upsertEvaluationRunCommandSchema = z.object({
  tenantId: z.string(),
  data: z.unknown(),
  retentionDays: z.number().int().positive().optional(),
});

export type ExecuteEvaluationCommand = z.infer<typeof executeEvaluationCommandSchema>;
export type UpsertEvaluationRunCommand = z.infer<typeof upsertEvaluationRunCommandSchema>;
