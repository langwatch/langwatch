import { z } from "zod/v4";
import { simulationMessageSchema } from "./simulation";

const simulationRunIdentitySchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  occurredAt: z.number(),
});

const simulationRunDetailsSchema = z.object({
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const simulationQueueRunSchema = simulationRunIdentitySchema
  .extend(simulationRunDetailsSchema.shape)
  .extend({
    secretParameters: z.record(z.string(), z.string()).optional(),
    target: z
      .object({
        type: z.enum(["prompt", "http", "code", "workflow"]),
        referenceId: z.string(),
      })
      .optional(),
  });
export type SimulationQueueRun = z.infer<typeof simulationQueueRunSchema>;

export const simulationStartRunSchema = simulationRunIdentitySchema.extend(
  simulationRunDetailsSchema.shape,
);
export type SimulationStartRun = z.infer<typeof simulationStartRunSchema>;

export const simulationMessageSnapshotSchema = simulationRunIdentitySchema.extend({
  messages: z.array(simulationMessageSchema),
  traceIds: z.array(z.string()).default([]),
  status: z.string().optional(),
});
export type SimulationMessageSnapshot = z.infer<
  typeof simulationMessageSnapshotSchema
>;

export const simulationTextMessageStartSchema = simulationRunIdentitySchema.extend({
  messageId: z.string(),
  role: z.string(),
  messageIndex: z.number().optional(),
});
export type SimulationTextMessageStart = z.infer<
  typeof simulationTextMessageStartSchema
>;

export const simulationTextMessageEndSchema = simulationRunIdentitySchema.extend({
  messageId: z.string(),
  role: z.string(),
  content: z.string(),
  message: z.record(z.string(), z.unknown()).optional(),
  traceId: z.string().optional(),
  messageIndex: z.number().optional(),
});
export type SimulationTextMessageEnd = z.infer<
  typeof simulationTextMessageEndSchema
>;

export const simulationFinishRunSchema = simulationRunIdentitySchema.extend({
  results: z
    .object({
      verdict: z.enum(["success", "failure", "inconclusive"]),
      reasoning: z.string().optional(),
      metCriteria: z.array(z.string()).default([]),
      unmetCriteria: z.array(z.string()).default([]),
      error: z.string().optional(),
    })
    .optional(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
  status: z.string().optional(),
  scenarioId: z.string().optional(),
  batchRunId: z.string().optional(),
  scenarioSetId: z.string().optional(),
  traceIds: z.array(z.string()).optional(),
});
export type SimulationFinishRun = z.infer<typeof simulationFinishRunSchema>;

export const simulationCancelRunSchema = simulationRunIdentitySchema;
export type SimulationCancelRun = z.infer<typeof simulationCancelRunSchema>;

export const simulationDeleteRunSchema = simulationRunIdentitySchema;
export type SimulationDeleteRun = z.infer<typeof simulationDeleteRunSchema>;
