/**
 * The plan a run's `started` event carries (ARCHITECTURE §9, D4 and D5): everything a cell reads
 * from the run's fold to execute, fixed when the run starts.
 * Design: modules/experiment/specs/experiment-run-execution.md.
 */
import { runActorSchema } from "@langwatch/scenario-contract";
import { z } from "zod";

import {
  datasetColumnSchema,
  type EvaluatorConfig,
  evaluatorConfigSchema,
  type TargetConfig,
  targetConfigSchema,
} from "./experiment-workbench.ts";
import { executionScopeSchema } from "./workbench/execution/types.ts";

/** A target as the workbench state types it; its object schema checks the shape. */
const planTargetSchema = z.custom<TargetConfig>((value) => targetConfigSchema.validate(value));

/** An evaluator as the workbench state types it; its object schema checks the shape. */
const planEvaluatorSchema = z.custom<EvaluatorConfig>((value) =>
  evaluatorConfigSchema.validate(value),
);

/** Where a run was started from, which decides what its results write back to. */
export const experimentRunOriginSchema = z.enum(["workbench", "saved", "workflow"]);

/** A phase-1 cell: one row against one target, then that target's evaluators in order. */
export const experimentRunTargetCellSchema = z.object({
  ordinal: z.number().int().nonnegative(),
  phase: z.literal(1),
  rowIndex: z.number().int().nonnegative(),
  targetId: z.string(),
  evaluatorIds: z.array(z.string()),
  /** An evaluator re-run judges this output instead of executing the target. */
  precomputedTargetOutput: z.unknown().optional(),
  skipTarget: z.boolean().optional(),
  traceId: z.string().optional(),
});

/** Why a comparison cannot be built for any row: known at start, from the configuration alone. */
export const experimentRunComparisonSetupSkipSchema = z.object({
  kind: z.enum(["too-few-variants", "golden-not-set", "variant-not-found"]),
  variantNames: z.array(z.string()),
});

/** A phase-2 cell: one row's comparison, judged once every target cell has finished. */
export const experimentRunComparisonCellSchema = z.object({
  ordinal: z.number().int().nonnegative(),
  phase: z.literal(2),
  rowIndex: z.number().int().nonnegative(),
  /** The column the verdict is stored under. */
  targetId: z.string(),
  evaluatorId: z.string(),
  setupSkip: experimentRunComparisonSetupSkipSchema.optional(),
});

export const experimentRunPlanCellSchema = z.discriminatedUnion("phase", [
  experimentRunTargetCellSchema,
  experimentRunComparisonCellSchema,
]);

/** A target's prompt or workflow as resolved at start, so every cell runs the same one. */
export const experimentRunPinnedVersionsSchema = z.object({
  prompts: z.array(
    z.object({ targetId: z.string(), promptId: z.string(), version: z.number().int() }),
  ),
  workflows: z.array(
    z.object({ targetId: z.string(), workflowId: z.string(), versionId: z.string() }),
  ),
});

export const experimentRunPlanSchema = z.object({
  concurrency: z.number().int().positive(),
  origin: experimentRunOriginSchema,
  persistResults: z.boolean(),
  actor: runActorSchema.optional(),
  /** What a poll of the run answers with: its experiment's slug and the link to its results. */
  experimentSlug: z.string().optional(),
  runUrl: z.string().optional(),
  scope: executionScopeSchema,
  /** The dataset id a cell reads its mapping buckets from. */
  mappingDatasetId: z.string(),
  targets: z.array(planTargetSchema),
  evaluators: z.array(planEvaluatorSchema),
  datasetColumns: z.array(datasetColumnSchema),
  /** The rows the run's cells touch, each once. */
  rows: z.array(
    z.object({
      rowIndex: z.number().int().nonnegative(),
      entry: z.record(z.string(), z.unknown()),
    }),
  ),
  /** Phase 1 in ordinal order, then phase 2. */
  cells: z.array(experimentRunPlanCellSchema),
  pinned: experimentRunPinnedVersionsSchema,
  /** Prior target outputs a comparison reads for variants this run does not execute. */
  seedTargetOutputs: z
    .record(
      z.string(),
      z.object({
        output: z.unknown(),
        cost: z.number().optional(),
        duration: z.number().optional(),
      }),
    )
    .optional(),
});

export type ExperimentRunOrigin = z.infer<typeof experimentRunOriginSchema>;
export type ExperimentRunTargetCell = z.infer<typeof experimentRunTargetCellSchema>;
export type ExperimentRunComparisonCell = z.infer<typeof experimentRunComparisonCellSchema>;
export type ExperimentRunPlanCell = z.infer<typeof experimentRunPlanCellSchema>;
export type ExperimentRunPlan = z.infer<typeof experimentRunPlanSchema>;
