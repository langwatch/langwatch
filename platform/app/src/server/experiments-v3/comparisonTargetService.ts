/**
 * Builds and attaches a "comparison" evaluator target to an experiments-v3
 * workbench state from a CLI/API-key-authenticated request.
 *
 * A comparison is not a distinct target type: it is an `evaluator` target
 * whose `targetEvaluatorId` points at a `langevals/select_best_compare` row
 * and whose `comparison` config lists the other targets ("variants") it
 * judges between. The Workbench assembles the same shape from its own handler
 * code in EvaluationsV3Table.tsx; this module is the API-key path to it.
 *
 * Must work correctly against an experiment that already has targets, not
 * just a fresh one: referencing a prompt/agent that's already a target in
 * this experiment reuses that target rather than creating a duplicate column.
 */

import type { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  COMPARISON_EVALUATOR_TYPE,
  type ComparisonEvaluatorConfig,
  type DatasetReference,
  isGoldenFieldSatisfied,
  type TargetConfig,
} from "~/experiments-v3/types";
import { deriveComparisonTargetMappings } from "~/experiments-v3/utils/mappingInference";
import type { Field } from "~/optimization_studio/types/dsl";
import { AgentService } from "~/server/agents/agent.service";
import { EvaluatorService } from "~/server/evaluators/evaluator.service";
import { ExperimentDatasetMissingError } from "~/server/experiments/errors";
import {
  ComparisonFieldNotInDatasetError,
  ComparisonGoldenFieldRequiredError,
} from "~/server/experiments-v3/errors";
import { PromptService } from "~/server/prompt-config/prompt.service";
import {
  type AgentLookup,
  type EvaluatorLookup,
  type PromptLookup,
  resolveVariantTargets,
  type VariantResolution,
} from "./comparisonVariants";

export const variantSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existingTarget"), targetId: z.string() }),
  z.object({
    kind: z.literal("prompt"),
    handle: z.string(),
    // Versions are whole numbers counting from 0, and the CLI already refuses
    // anything else. Constraining it here too means both entry points reject a
    // bad version as a validation error rather than one of them resolving no
    // prompt and reporting it as a missing one.
    version: z.number().int().nonnegative().optional(),
  }),
  z.object({ kind: z.literal("agent"), agentId: z.string() }),
]);
export type VariantSpec = z.infer<typeof variantSpecSchema>;

export const attachComparisonBodySchema = z.object({
  variants: z.array(variantSpecSchema).min(2),
  goldenField: z.string().optional(),
  hasGoldenAnswer: z.boolean().optional(),
  inputField: z.string().optional(),
  includeMetrics: z.array(z.enum(["cost", "duration"])).optional(),
  randomizeOrder: z.boolean().optional(),
});
export type AttachComparisonBody = z.infer<typeof attachComparisonBodySchema>;

export type AttachComparisonResult = {
  targets: TargetConfig[];
  comparisonTargetId: string;
  createdTargetIds: string[];
  reusedTargetIds: string[];
};

/**
 * Builds the comparison's judging config and refuses one that cannot be run:
 * `goldenField`/`inputField` are free text on the wire, unlike the workbench's
 * dropdown, so a typo would otherwise persist and only surface as a missing
 * value once the experiment runs.
 */
const buildComparisonConfig = ({
  body,
  variantTargetIds,
  activeDataset,
}: {
  body: AttachComparisonBody;
  variantTargetIds: string[];
  activeDataset: DatasetReference;
}): ComparisonEvaluatorConfig => {
  for (const [field, value] of [
    ["goldenField", body.goldenField],
    ["inputField", body.inputField],
  ] as const) {
    if (value && !activeDataset.columns.some((c) => c.name === value)) {
      throw new ComparisonFieldNotInDatasetError({
        field,
        value,
        datasetId: activeDataset.id,
        availableColumns: activeDataset.columns.map((c) => c.name),
      });
    }
  }

  const config: ComparisonEvaluatorConfig = {
    variants: variantTargetIds,
    hasGoldenAnswer: body.hasGoldenAnswer ?? !!body.goldenField,
    goldenField: body.goldenField,
    inputField: body.inputField,
    includeMetrics: [...new Set(body.includeMetrics ?? [])],
    randomizeOrder: body.randomizeOrder ?? true,
  };

  if (!isGoldenFieldSatisfied(config)) {
    throw new ComparisonGoldenFieldRequiredError();
  }
  return config;
};

/**
 * The project's comparison evaluator row, created on first use. One row serves
 * every comparison in the project: the per-comparison detail lives on the
 * target's `comparison` config, not on the evaluator.
 */
const resolveComparisonEvaluator = async ({
  evaluatorService,
  projectId,
}: {
  evaluatorService: EvaluatorLookup;
  projectId: string;
}) => {
  const existingEvaluators = await evaluatorService.getAllWithFields({
    projectId,
  });
  const existing = existingEvaluators.find((e) => {
    const config = e.config as { evaluatorType?: string } | null;
    return config?.evaluatorType === COMPARISON_EVALUATOR_TYPE;
  });
  if (existing) return existing;

  const created = await evaluatorService.createWithDefaults({
    id: `evaluator_${nanoid()}`,
    projectId,
    name: "Comparison",
    type: "evaluator",
    config: { evaluatorType: COMPARISON_EVALUATOR_TYPE },
  });
  return evaluatorService.enrichWithFields(created);
};

/** The evaluator target that carries the comparison, mapped to the dataset. */
const buildComparisonTarget = ({
  evaluator,
  config,
  activeDataset,
}: {
  evaluator: Awaited<ReturnType<typeof resolveComparisonEvaluator>>;
  config: ComparisonEvaluatorConfig;
  activeDataset: DatasetReference;
}): TargetConfig => ({
  id: `target_${nanoid()}`,
  type: "evaluator",
  targetEvaluatorId: evaluator.id,
  inputs: evaluator.fields.map((f) => ({
    identifier: f.identifier,
    type: f.type as Field["type"],
    ...(f.optional && { optional: true }),
  })),
  outputs: evaluator.outputFields.map((f) => ({
    identifier: f.identifier,
    type: f.type as Field["type"],
  })),
  mappings: {
    [activeDataset.id]: deriveComparisonTargetMappings(config, activeDataset),
  },
  comparison: config,
});

/**
 * Attaches a comparison target to an experiment's targets, resolving each
 * variant spec (reusing an existing target when one already matches,
 * otherwise creating it), and returns the full updated target list ready to
 * persist via ExperimentService.updateWorkbenchState.
 *
 * `services` is an optional injection seam for unit tests — real callers
 * (the Hono route) omit it and get real Prisma-backed services.
 */
export const attachComparison = async ({
  prisma,
  projectId,
  targets,
  datasets,
  activeDatasetId,
  body,
  services,
}: {
  prisma: PrismaClient;
  projectId: string;
  targets: TargetConfig[];
  datasets: DatasetReference[];
  activeDatasetId: string;
  body: AttachComparisonBody;
  services?: {
    promptService?: PromptLookup;
    agentService?: AgentLookup;
    evaluatorService?: EvaluatorLookup;
  };
}): Promise<AttachComparisonResult> => {
  // The comparison's mappings are derived against one dataset, so which one it
  // is has to be a fact rather than a guess: the experiment's own
  // `activeDatasetId`, resolved against its own list. An experiment carrying no
  // datasets, or an `activeDatasetId` naming one it no longer has, cannot host
  // a comparison at all.
  const activeDataset = datasets.find((d) => d.id === activeDatasetId);
  if (!activeDataset) {
    throw new ExperimentDatasetMissingError({ activeDatasetId });
  }

  const resolution: VariantResolution = {
    allTargets: [...targets],
    datasets,
    activeDataset,
    createdTargetIds: [],
    reusedTargetIds: [],
  };

  const variantTargetIds = await resolveVariantTargets({
    specs: body.variants,
    projectId,
    promptService: services?.promptService ?? new PromptService(prisma),
    agentService: services?.agentService ?? AgentService.create(prisma),
    resolution,
  });

  const comparisonConfig = buildComparisonConfig({
    body,
    variantTargetIds,
    activeDataset,
  });

  const comparisonTarget = buildComparisonTarget({
    evaluator: await resolveComparisonEvaluator({
      evaluatorService:
        services?.evaluatorService ?? EvaluatorService.create(prisma),
      projectId,
    }),
    config: comparisonConfig,
    activeDataset,
  });

  resolution.allTargets.push(comparisonTarget);

  return {
    targets: resolution.allTargets,
    comparisonTargetId: comparisonTarget.id,
    createdTargetIds: resolution.createdTargetIds,
    reusedTargetIds: resolution.reusedTargetIds,
  };
};
