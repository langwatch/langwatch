import type { WorkflowVersion } from "@prisma/client";
import { z } from "zod";

// --- Zod-first schemas ---

export const anyJSONDumpedClassSchema = z
  .object({
    __class__: z.string().optional(),
  })
  .and(z.record(z.string(), z.any()));

export type AnyJSONDumpedClass = z.infer<typeof anyJSONDumpedClassSchema>;

export const dSPyTraceSchema = z.object({
  input: anyJSONDumpedClassSchema,
  pred: anyJSONDumpedClassSchema,
});

export type DSPyTrace = z.infer<typeof dSPyTraceSchema>;

export const dSPyExampleSchema = z.object({
  hash: z.string(),
  example: anyJSONDumpedClassSchema,
  pred: anyJSONDumpedClassSchema,
  score: z.number(),
  trace: z.array(dSPyTraceSchema).optional().nullable(),
});

export type DSPyExample = z.infer<typeof dSPyExampleSchema>;

export const dSPyLLMCallSchema = z.object({
  hash: z.string(),
  __class__: z.string(),
  response: anyJSONDumpedClassSchema,
  model: z.string().optional().nullable(),
  prompt_tokens: z.number().optional().nullable(),
  completion_tokens: z.number().optional().nullable(),
  cost: z.number().optional().nullable(),
});

export type DSPyLLMCall = z.infer<typeof dSPyLLMCallSchema>;

export const dSPyOptimizerSchema = z.object({
  name: z.string(),
  parameters: z.record(z.string(), z.any()),
});

export type DSPyOptimizer = z.infer<typeof dSPyOptimizerSchema>;

export const dSPyPredictorSchema = z.object({
  name: z.string(),
  predictor: anyJSONDumpedClassSchema,
});

export type DSPyPredictor = z.infer<typeof dSPyPredictorSchema>;

export const dSPyStepSchema = z.object({
  project_id: z.string(),
  run_id: z.string(),
  workflow_version_id: z.string().optional().nullable(),
  experiment_id: z.string(),
  index: z.string(),
  score: z.number(),
  label: z.string(),
  optimizer: dSPyOptimizerSchema,
  predictors: z.array(dSPyPredictorSchema),
  examples: z.array(dSPyExampleSchema),
  llm_calls: z.array(dSPyLLMCallSchema),
  timestamps: z.object({
    created_at: z.number(),
    inserted_at: z.number(),
    updated_at: z.number(),
  }),
});

export type DSPyStep = z.infer<typeof dSPyStepSchema>;

export const dSPyStepRESTParamsSchema = dSPyStepSchema
  .omit({
    timestamps: true,
    project_id: true,
    experiment_id: true,
    examples: true,
    llm_calls: true,
  })
  .and(
    z.object({
      experiment_id: z.string().optional().nullable(),
      experiment_slug: z.string().optional().nullable(),
      timestamps: z.object({
        created_at: z.number(),
      }),
      examples: z.array(dSPyExampleSchema.omit({ hash: true })),
      llm_calls: z.array(dSPyLLMCallSchema.omit({ hash: true })),
    }),
  );

export type DSPyStepRESTParams = z.infer<typeof dSPyStepRESTParamsSchema>;

export const dSPyStepSummarySchema = z.object({
  run_id: z.string(),
  index: z.string(),
  score: z.number(),
  label: z.string(),
  optimizer: z.object({
    name: z.string(),
  }),
  llm_calls_summary: z.object({
    total: z.number(),
    total_tokens: z.number(),
    total_cost: z.number(),
  }),
  timestamps: z.object({
    created_at: z.number(),
  }),
});

export type DSPyStepSummary = z.infer<typeof dSPyStepSummarySchema>;

const workflowVersionSchema = z.any();

export const dSPyRunsSummarySchema = z.object({
  runId: z.string(),
  workflow_version: workflowVersionSchema.optional(),
  steps: z.array(dSPyStepSummarySchema),
  created_at: z.number(),
});

export type DSPyRunsSummary = z.infer<typeof dSPyRunsSummarySchema>;

export const eSBatchEvaluationTargetTypeSchema = z.union([
  z.literal("prompt"),
  z.literal("agent"),
  z.literal("evaluator"),
  z.literal("custom"),
]);

export type ESBatchEvaluationTargetType = z.infer<typeof eSBatchEvaluationTargetTypeSchema>;

export const eSBatchEvaluationTargetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: eSBatchEvaluationTargetTypeSchema,
  prompt_id: z.string().optional().nullable(),
  prompt_version: z.number().optional().nullable(),
  agent_id: z.string().optional().nullable(),
  evaluator_id: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .nullable(),
});

export type ESBatchEvaluationTarget = z.infer<typeof eSBatchEvaluationTargetSchema>;

export const eSBatchEvaluationSchema = z.object({
  project_id: z.string(),
  experiment_id: z.string(),
  run_id: z.string(),
  workflow_version_id: z.string().optional().nullable(),
  progress: z.number().optional().nullable(),
  total: z.number().optional().nullable(),
  targets: z.array(eSBatchEvaluationTargetSchema).optional().nullable(),
  dataset: z.array(
    z.object({
      index: z.number(),
      target_id: z.string().optional().nullable(),
      entry: z.record(z.string(), z.any()),
      predicted: z.record(z.string(), z.any()).optional(),
      cost: z.number().optional().nullable(),
      duration: z.number().optional().nullable(),
      error: z.string().optional().nullable(),
      trace_id: z.string().optional().nullable(),
    }),
  ),
  evaluations: z.array(
    z.object({
      evaluator: z.string(),
      name: z.string().optional().nullable(),
      target_id: z.string().optional().nullable(),
      status: z.union([
        z.literal("processed"),
        z.literal("skipped"),
        z.literal("error"),
      ]),
      index: z.number(),
      duration: z.number().optional().nullable(),
      inputs: z.record(z.string(), z.any()).optional(),
      score: z.number().optional().nullable(),
      label: z.string().optional().nullable(),
      passed: z.boolean().optional().nullable(),
      details: z.string().optional().nullable(),
      cost: z.number().optional().nullable(),
    }),
  ),
  timestamps: z.object({
    created_at: z.number(),
    inserted_at: z.number(),
    updated_at: z.number(),
    stopped_at: z.number().optional().nullable(),
    finished_at: z.number().optional().nullable(),
  }),
});

export type ESBatchEvaluation = z.infer<typeof eSBatchEvaluationSchema>;

export const eSBatchEvaluationTargetRESTSchema = eSBatchEvaluationTargetSchema
  .omit({ type: true })
  .and(
    z.object({
      type: eSBatchEvaluationTargetTypeSchema.optional(),
    }),
  );

export type ESBatchEvaluationTargetREST = z.infer<typeof eSBatchEvaluationTargetRESTSchema>;

export const eSBatchEvaluationRESTParamsSchema = eSBatchEvaluationSchema
  .partial()
  .omit({
    project_id: true,
    experiment_id: true,
    timestamps: true,
    targets: true,
  })
  .and(
    z.object({
      experiment_id: z.string().optional().nullable(),
      experiment_slug: z.string().optional().nullable(),
      run_id: z.string().nullable(),
      workflow_id: z.string().optional().nullable(),
      name: z.string().optional().nullable(),
      targets: z.array(eSBatchEvaluationTargetRESTSchema).optional().nullable(),
      timestamps: z
        .object({
          created_at: z.number().optional().nullable(),
          finished_at: z.number().optional().nullable(),
          stopped_at: z.number().optional().nullable(),
        })
        .optional(),
    }),
  );

export type ESBatchEvaluationRESTParams = z.infer<typeof eSBatchEvaluationRESTParamsSchema>;

export const appliedOptimizationFieldSchema = z.object({
  identifier: z.string(),
  field_type: z.union([z.literal("input"), z.literal("output")]),
  prefix: z.string().optional(),
  desc: z.string().optional(),
});

export type AppliedOptimizationField = z.infer<typeof appliedOptimizationFieldSchema>;

export const appliedOptimizationSchema = z.object({
  id: z.string(),
  instructions: z.string().optional(),
  fields: z.array(appliedOptimizationFieldSchema).optional(),
  demonstrations: z.array(z.record(z.string(), z.any())).optional(),
});

export type AppliedOptimization = z.infer<typeof appliedOptimizationSchema>;
