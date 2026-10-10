import type { Named } from "@langwatch/module";
import { z } from "zod";

import { experimentRunWorkflowVersionSchema } from "./experiment-run.ts";
import type * as experimentRunModule from "./experiment-run.ts";

// ---------------------------------------------------------------------------
// Experiment schemas (Zod-first). DSPy optimization steps and batch-evaluation
// shapes are defined as Zod schemas with their TypeScript types inferred via
// z.infer, so schema and type stay in lock-step.
// ---------------------------------------------------------------------------

// Value type is `any` by design: DSPy's shape varies between releases, and
// we preserve all keys so the stored dump stays whole and views can read it
// defensively.
const anyJSONDumpedClassSchema = z
  .object({ __class__: z.string().optional() })
  .and(z.record(z.string(), z.any()));

const dSPyTraceSchema = z.object({
  input: anyJSONDumpedClassSchema,
  pred: anyJSONDumpedClassSchema,
});

const dSPyExampleSchemaDefinition = z.object({
  hash: z.string(),
  example: anyJSONDumpedClassSchema,
  pred: anyJSONDumpedClassSchema,
  score: z.number(),
  trace: z.array(dSPyTraceSchema).optional().nullable(),
});
export interface DSPyExampleSchema extends Named<typeof dSPyExampleSchemaDefinition> {}
export const dSPyExampleSchema: DSPyExampleSchema = dSPyExampleSchemaDefinition;

export type DSPyExample = z.infer<typeof dSPyExampleSchema>;

const dSPyLLMCallSchemaDefinition = z.object({
  hash: z.string(),
  __class__: z.string(),
  response: anyJSONDumpedClassSchema,
  model: z.string().optional().nullable(),
  prompt_tokens: z.number().optional().nullable(),
  completion_tokens: z.number().optional().nullable(),
  cost: z.number().optional().nullable(),
});
export interface DSPyLLMCallSchema extends Named<typeof dSPyLLMCallSchemaDefinition> {}
export const dSPyLLMCallSchema: DSPyLLMCallSchema = dSPyLLMCallSchemaDefinition;

export type DSPyLLMCall = z.infer<typeof dSPyLLMCallSchema>;

const dSPyOptimizerSchemaDefinition = z.object({
  name: z.string(),
  parameters: z.record(z.string(), z.unknown()),
});
export interface DSPyOptimizerSchema extends Named<typeof dSPyOptimizerSchemaDefinition> {}
export const dSPyOptimizerSchema: DSPyOptimizerSchema = dSPyOptimizerSchemaDefinition;

export type DSPyOptimizer = z.infer<typeof dSPyOptimizerSchema>;

const dSPyPredictorSchemaDefinition = z.object({
  name: z.string(),
  predictor: anyJSONDumpedClassSchema,
});
export interface DSPyPredictorSchema extends Named<typeof dSPyPredictorSchemaDefinition> {}
export const dSPyPredictorSchema: DSPyPredictorSchema = dSPyPredictorSchemaDefinition;

export type DSPyPredictor = z.infer<typeof dSPyPredictorSchema>;

const dSPyStepSchemaDefinition = z.object({
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
export interface DSPyStepSchema extends Named<typeof dSPyStepSchemaDefinition> {}
export const dSPyStepSchema: DSPyStepSchema = dSPyStepSchemaDefinition;

export type DSPyStep = z.infer<typeof dSPyStepSchema>;

const dSPyStepRESTParamsSchemaDefinition = z.object({
  ...dSPyStepSchema.omit({
    timestamps: true,
    project_id: true,
    experiment_id: true,
    examples: true,
    llm_calls: true,
  }).shape,
  experiment_id: z.string().optional().nullable(),
  experiment_slug: z.string().optional().nullable(),
  timestamps: z.object({
    created_at: z.number(),
  }),
  examples: z.array(dSPyExampleSchema.omit({ hash: true })),
  llm_calls: z.array(dSPyLLMCallSchema.omit({ hash: true })),
});
export interface DSPyStepRESTParamsSchema extends Named<
  typeof dSPyStepRESTParamsSchemaDefinition
> {}
export const dSPyStepRESTParamsSchema: DSPyStepRESTParamsSchema =
  dSPyStepRESTParamsSchemaDefinition;

export type DSPyStepRESTParams = z.infer<typeof dSPyStepRESTParamsSchema>;

/** `POST /api/dspy/log_steps`'s body: the optimizer's steps, in the order they ran. */
const dSPyLogStepsBodySchemaDefinition = z.array(dSPyStepRESTParamsSchema);
export interface DSPyLogStepsBodySchema extends Named<typeof dSPyLogStepsBodySchemaDefinition> {}
export const dSPyLogStepsBodySchema: DSPyLogStepsBodySchema = dSPyLogStepsBodySchemaDefinition;

const dSPyLogStepsResponseSchemaDefinition = z.object({
  message: z.string().describe("Human-readable confirmation"),
});
export interface DSPyLogStepsResponseSchema extends Named<
  typeof dSPyLogStepsResponseSchemaDefinition
> {}
export const dSPyLogStepsResponseSchema: DSPyLogStepsResponseSchema =
  dSPyLogStepsResponseSchemaDefinition;

const dSPyStepSummarySchemaDefinition = z.object({
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
export interface DSPyStepSummarySchema extends Named<typeof dSPyStepSummarySchemaDefinition> {}
export const dSPyStepSummarySchema: DSPyStepSummarySchema = dSPyStepSummarySchemaDefinition;

export type DSPyStepSummary = z.infer<typeof dSPyStepSummarySchema>;

/**
 * Batch evaluation target types: `prompt`/`agent` from Evaluations V3,
 * `evaluator` (an evaluator run as a target, for testing evaluators), and
 * `custom` (an external target from the API, e.g. the Python SDK).
 */
const eSBatchEvaluationTargetTypeSchemaDefinition = z.union([
  z.literal("prompt"),
  z.literal("agent"),
  z.literal("evaluator"),
  z.literal("workflow"),
  z.literal("custom"),
]);
export interface ESBatchEvaluationTargetTypeSchema extends Named<
  typeof eSBatchEvaluationTargetTypeSchemaDefinition
> {}
export const eSBatchEvaluationTargetTypeSchema: ESBatchEvaluationTargetTypeSchema =
  eSBatchEvaluationTargetTypeSchemaDefinition;

export type ESBatchEvaluationTargetType = z.infer<typeof eSBatchEvaluationTargetTypeSchema>;

/**
 * Target metadata stored in batch evaluation for Evaluations V3.
 * Captures the state of targets at execution time so we can display
 * results even after targets are modified or deleted.
 */
const eSBatchEvaluationTargetSchemaDefinition = z.object({
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
export interface ESBatchEvaluationTargetSchema extends Named<
  typeof eSBatchEvaluationTargetSchemaDefinition
> {}
export const eSBatchEvaluationTargetSchema: ESBatchEvaluationTargetSchema =
  eSBatchEvaluationTargetSchemaDefinition;

export type ESBatchEvaluationTarget = z.infer<typeof eSBatchEvaluationTargetSchema>;

export const mapLegacyExperimentTargets = (
  targets: ESBatchEvaluationTarget[],
): experimentRunModule.ExperimentRunCommandTarget[] =>
  targets.map((target) => ({
    id: target.id,
    name: target.name,
    type: target.type,
    promptId: target.prompt_id,
    promptVersion: target.prompt_version,
    agentId: target.agent_id,
    evaluatorId: target.evaluator_id,
    model: target.model,
    metadata: target.metadata,
  }));

const eSBatchEvaluationSchemaDefinition = z.object({
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
      entry: z.record(z.string(), z.unknown()),
      predicted: z.record(z.string(), z.unknown()).optional().nullable(),
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
      status: z.union([z.literal("processed"), z.literal("skipped"), z.literal("error")]),
      index: z.number(),
      duration: z.number().optional().nullable(),
      inputs: z.record(z.string(), z.unknown()).optional().nullable(),
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
export interface ESBatchEvaluationSchema extends Named<typeof eSBatchEvaluationSchemaDefinition> {}
export const eSBatchEvaluationSchema: ESBatchEvaluationSchema = eSBatchEvaluationSchemaDefinition;

export type ESBatchEvaluation = z.infer<typeof eSBatchEvaluationSchema>;

/**
 * Target in REST API params - type is optional as it can be
 * extracted from metadata or defaulted to "custom"
 */
const eSBatchEvaluationTargetRESTSchemaDefinition = z.object({
  ...eSBatchEvaluationTargetSchema.omit({ type: true }).shape,
  type: eSBatchEvaluationTargetTypeSchema.optional(),
});
export interface ESBatchEvaluationTargetRESTSchema extends Named<
  typeof eSBatchEvaluationTargetRESTSchemaDefinition
> {}
export const eSBatchEvaluationTargetRESTSchema: ESBatchEvaluationTargetRESTSchema =
  eSBatchEvaluationTargetRESTSchemaDefinition;

export type ESBatchEvaluationTargetREST = z.infer<typeof eSBatchEvaluationTargetRESTSchema>;

/** Rows and verdicts the whole run reported; read from the batch that ends the run. */
const batchEvaluationExpectedCountsSchema = z.object({
  dataset: z.number().int().nonnegative(),
  evaluations: z.number().int().nonnegative(),
});

// Duplicate in evaluation-contract (evaluation-rest.schemas.ts); keep in step.
const eSBatchEvaluationRESTParamsSchemaDefinition = z.object({
  ...eSBatchEvaluationSchema.partial().omit({
    project_id: true,
    experiment_id: true,
    timestamps: true,
    targets: true,
  }).shape,
  experiment_id: z.string().optional().nullable(),
  experiment_slug: z.string().optional().nullable(),
  run_id: z.string(),
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
  expected: batchEvaluationExpectedCountsSchema.optional().nullable(),
});
export interface ESBatchEvaluationRESTParamsSchema extends Named<
  typeof eSBatchEvaluationRESTParamsSchemaDefinition
> {}
export const eSBatchEvaluationRESTParamsSchema: ESBatchEvaluationRESTParamsSchema =
  eSBatchEvaluationRESTParamsSchemaDefinition;

export type ESBatchEvaluationRESTParams = z.infer<typeof eSBatchEvaluationRESTParamsSchema>;

/** What the SDK's batch result log reports, for one project. */
export type LogBatchEvaluationInput = Readonly<{
  projectId: string;
  params: ESBatchEvaluationRESTParams;
}>;

const appliedOptimizationFieldSchemaDefinition = z.object({
  identifier: z.string(),
  field_type: z.union([z.literal("input"), z.literal("output")]),
  prefix: z.string().optional(),
  desc: z.string().optional(),
});
export interface AppliedOptimizationFieldSchema extends Named<
  typeof appliedOptimizationFieldSchemaDefinition
> {}
export const appliedOptimizationFieldSchema: AppliedOptimizationFieldSchema =
  appliedOptimizationFieldSchemaDefinition;

export type AppliedOptimizationField = z.infer<typeof appliedOptimizationFieldSchema>;

const dSPyRunsSummarySchemaDefinition = z.object({
  runId: z.string(),
  workflow_version: experimentRunWorkflowVersionSchema.optional(),
  steps: z.array(dSPyStepSummarySchema),
  created_at: z.number(),
});
export interface DSPyRunsSummarySchema extends Named<typeof dSPyRunsSummarySchemaDefinition> {}
export const dSPyRunsSummarySchema: DSPyRunsSummarySchema = dSPyRunsSummarySchemaDefinition;

export type DSPyRunsSummary = z.infer<typeof dSPyRunsSummarySchema>;

const appliedOptimizationSchemaDefinition = z.object({
  id: z.string(),
  instructions: z.string().optional(),
  fields: z.array(appliedOptimizationFieldSchema).optional(),
  demonstrations: z.array(z.record(z.string(), z.unknown())).optional(),
});
export interface AppliedOptimizationSchema extends Named<
  typeof appliedOptimizationSchemaDefinition
> {}
export const appliedOptimizationSchema: AppliedOptimizationSchema =
  appliedOptimizationSchemaDefinition;

export type AppliedOptimization = z.infer<typeof appliedOptimizationSchema>;

export const LEGACY_EXPERIMENT_TASK_TYPES = {
  real_time: "Real-time evaluation",
  llm_app: "Offline evaluation",
  prompt_creation: "Prompt Creation",
  custom_evaluator: "Evaluate your Evaluator",
  scan: "Scan for Vulnerabilities (Coming Soon)",
} as const;

export type LegacyExperimentTaskType = keyof typeof LEGACY_EXPERIMENT_TASK_TYPES;

export const isLegacyOnlineEvaluationWorkbenchState = (workbenchState: unknown): boolean => {
  if (!workbenchState || typeof workbenchState !== "object" || Array.isArray(workbenchState)) {
    return false;
  }

  return (workbenchState as Record<string, unknown>).task === "real_time";
};
