import { z } from "zod";
import type { WorkflowVersion } from "@prisma/client";

// ---------------------------------------------------------------------------
// Experiment schemas (Zod-first). DSPy optimization steps and batch-evaluation
// shapes are defined as Zod schemas with their TypeScript types inferred via
// z.infer, so schema and type stay in lock-step.
// ---------------------------------------------------------------------------

const anyJSONDumpedClassSchema = z
  .object({ __class__: z.string().optional() })
  .and(z.record(z.string(), z.any()));

type AnyJSONDumpedClass = z.infer<typeof anyJSONDumpedClassSchema>;

const dSPyTraceSchema = z.object({
  input: anyJSONDumpedClassSchema,
  pred: anyJSONDumpedClassSchema,
});

type DSPyTrace = z.infer<typeof dSPyTraceSchema>;

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

/**
 * Valid target types for batch evaluations.
 * - prompt: LLM prompt target from Evaluations V3
 * - agent: Agent target from Evaluations V3
 * - evaluator: Evaluator used as a target (for testing evaluators)
 * - custom: External target from API (Python SDK, etc.)
 */
export const eSBatchEvaluationTargetTypeSchema = z.union([
  z.literal("prompt"),
  z.literal("agent"),
  z.literal("evaluator"),
  z.literal("custom"),
]);

export type ESBatchEvaluationTargetType = z.infer<
  typeof eSBatchEvaluationTargetTypeSchema
>;

/**
 * Target metadata stored in batch evaluation for Evaluations V3.
 * Captures the state of targets at execution time so we can display
 * results even after targets are modified or deleted.
 */
export const eSBatchEvaluationTargetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: eSBatchEvaluationTargetTypeSchema,
  /** For prompt targets: the prompt config ID */
  prompt_id: z.string().optional().nullable(),
  /** For prompt targets: the specific version used */
  prompt_version: z.number().optional().nullable(),
  /** For agent targets: the agent ID */
  agent_id: z.string().optional().nullable(),
  /** For evaluator targets: the evaluator ID */
  evaluator_id: z.string().optional().nullable(),
  /** Model used (for prompt targets) */
  model: z.string().optional().nullable(),
  /** Flexible metadata for comparison and analysis (model name, temperature, etc.) */
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .nullable(),
});

export type ESBatchEvaluationTarget = z.infer<
  typeof eSBatchEvaluationTargetSchema
>;

export const eSBatchEvaluationSchema = z.object({
  project_id: z.string(),
  experiment_id: z.string(),
  run_id: z.string(),
  workflow_version_id: z.string().optional().nullable(),
  progress: z.number().optional().nullable(),
  total: z.number().optional().nullable(),
  /** For Evaluations V3: stores target configurations at execution time */
  targets: z.array(eSBatchEvaluationTargetSchema).optional().nullable(),
  dataset: z.array(
    z.object({
      index: z.number(),
      /** For Evaluations V3: identifies which target produced this result */
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
      /** For Evaluations V3: identifies which target this evaluation is for */
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

/**
 * Target in REST API params - type is optional as it can be
 * extracted from metadata or defaulted to "custom"
 */
export const eSBatchEvaluationTargetRESTSchema = eSBatchEvaluationTargetSchema
  .omit({ type: true })
  .and(
    z.object({
      type: eSBatchEvaluationTargetTypeSchema.optional(),
    }),
  );

export type ESBatchEvaluationTargetREST = z.infer<
  typeof eSBatchEvaluationTargetRESTSchema
>;

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

export type ESBatchEvaluationRESTParams = z.infer<
  typeof eSBatchEvaluationRESTParamsSchema
>;

export const appliedOptimizationFieldSchema = z.object({
  identifier: z.string(),
  field_type: z.union([z.literal("input"), z.literal("output")]),
  prefix: z.string().optional(),
  desc: z.string().optional(),
});

export type AppliedOptimizationField = z.infer<
  typeof appliedOptimizationFieldSchema
>;

// WorkflowVersion is a Prisma row; keep the precise type while accepting it
// structurally at runtime.
const workflowVersionSchema = z.custom<WorkflowVersion>();

export const dSPyRunsSummarySchema = z.object({
  runId: z.string(),
  workflow_version: workflowVersionSchema.optional(),
  steps: z.array(dSPyStepSummarySchema),
  created_at: z.number(),
});

export type DSPyRunsSummary = z.infer<typeof dSPyRunsSummarySchema>;

export const appliedOptimizationSchema = z.object({
  id: z.string(),
  instructions: z.string().optional(),
  fields: z.array(appliedOptimizationFieldSchema).optional(),
  demonstrations: z.array(z.record(z.string(), z.any())).optional(),
});

export type AppliedOptimization = z.infer<typeof appliedOptimizationSchema>;
