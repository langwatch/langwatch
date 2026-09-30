import { z } from "zod";

// 0 is the indefinite sentinel (INDEFINITE_RETENTION_DAYS): the row is kept, never aged out.
const retentionDaysSchema = z.number().int().nonnegative().optional();

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
  retentionDays: retentionDaysSchema,
});

export type ExecuteEvaluationCommand = z.infer<typeof executeEvaluationCommandSchema>;
export type UpsertEvaluationRunCommand = z.infer<typeof upsertEvaluationRunCommandSchema>;
