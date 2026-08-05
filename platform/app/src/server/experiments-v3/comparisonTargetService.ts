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
  isComparisonEvaluator,
  isGoldenFieldSatisfied,
  type TargetConfig,
} from "~/experiments-v3/types";
import {
  buildHttpAgentTarget,
  convertHttpComponentConfig,
} from "~/experiments-v3/utils/httpAgentUtils";
import {
  deriveComparisonTargetMappings,
  inferAllTargetMappings,
} from "~/experiments-v3/utils/mappingInference";
import { getTargetMissingMappings } from "~/experiments-v3/utils/mappingValidation";
import type {
  Field,
  HttpComponentConfig,
} from "~/optimization_studio/types/dsl";
import { AgentService } from "~/server/agents/agent.service";
import { AgentNotFoundError } from "~/server/agents/errors";
import { EvaluatorService } from "~/server/evaluators/evaluator.service";
import { ExperimentDatasetMissingError } from "~/server/experiments/errors";
import {
  ComparisonFieldNotInDatasetError,
  ComparisonGoldenFieldRequiredError,
  ComparisonVariantAgentNotFoundError,
  ComparisonVariantIsComparisonError,
  ComparisonVariantsNotDistinctError,
  ComparisonVariantTargetNotFoundError,
  ComparisonVariantUnmappableError,
} from "~/server/experiments-v3/errors";
import { NotFoundError as PromptNotFoundError } from "~/server/prompt-config/errors/not-found-error";
import { PromptService } from "~/server/prompt-config/prompt.service";

export const variantSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existingTarget"), targetId: z.string() }),
  z.object({
    kind: z.literal("prompt"),
    handle: z.string(),
    version: z.number().optional(),
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

const DEFAULT_INPUT: Field = { identifier: "input", type: "str" };
const DEFAULT_OUTPUT: Field = { identifier: "output", type: "str" };

/**
 * The accumulators `attachComparison` owns and every resolver appends to: the
 * running target list plus the two id lists the response reports back, so a
 * caller can see what was built for it and what was already there.
 */
type VariantResolution = {
  allTargets: TargetConfig[];
  datasets: DatasetReference[];
  createdTargetIds: string[];
  reusedTargetIds: string[];
};

/** Records a freshly built target against the experiment and the response. */
const adoptNewTarget = (
  target: TargetConfig,
  resolution: VariantResolution,
  spec: Extract<VariantSpec, { kind: "prompt" | "agent" }>,
): TargetConfig => {
  finishNewTarget(target, resolution.datasets, spec);
  resolution.allTargets.push(target);
  resolution.createdTargetIds.push(target.id);
  return target;
};

/** A `target:<id>` variant: already in the experiment, or not a variant at all. */
const resolveExistingTargetVariant = (
  spec: Extract<VariantSpec, { kind: "existingTarget" }>,
  { allTargets }: VariantResolution,
): TargetConfig => {
  const found = allTargets.find((t) => t.id === spec.targetId);
  if (!found) {
    throw new ComparisonVariantTargetNotFoundError({
      targetId: spec.targetId,
      availableTargets: allTargets.map((t) => ({ id: t.id, type: t.type })),
    });
  }
  return found;
};

/**
 * A `prompt:<handle>[@version]` variant. An experiment that already runs this
 * prompt keeps its target rather than gaining a second column for the same
 * thing; a pinned version only matches a target on that same version.
 */
const resolvePromptVariant = async ({
  spec,
  projectId,
  promptService,
  resolution,
}: {
  spec: Extract<VariantSpec, { kind: "prompt" }>;
  projectId: string;
  promptService: PromptLookup;
  resolution: VariantResolution;
}): Promise<TargetConfig> => {
  const prompt = await promptService.getPromptByIdOrHandle({
    idOrHandle: spec.handle,
    projectId,
    version: spec.version,
  });
  if (!prompt) {
    throw new PromptNotFoundError(`Prompt "${spec.handle}" not found`);
  }

  const existing = resolution.allTargets.find(
    (t) =>
      t.type === "prompt" &&
      t.promptId === prompt.id &&
      (spec.version === undefined || t.promptVersionNumber === prompt.version),
  );
  if (existing) {
    resolution.reusedTargetIds.push(existing.id);
    return existing;
  }

  return adoptNewTarget(
    {
      id: `target_${nanoid()}`,
      type: "prompt",
      promptId: prompt.id,
      promptVersionId: prompt.versionId,
      promptVersionNumber: prompt.version,
      inputs: prompt.inputs?.length
        ? (prompt.inputs as Field[])
        : [DEFAULT_INPUT],
      outputs: prompt.outputs?.length
        ? (prompt.outputs as Field[])
        : [DEFAULT_OUTPUT],
      mappings: {},
    },
    resolution,
    spec,
  );
};

/** The agent row behind an `agent:<id>` variant, or a handled not-found. */
const loadVariantAgent = async ({
  spec,
  projectId,
  agentService,
}: {
  spec: Extract<VariantSpec, { kind: "agent" }>;
  projectId: string;
  agentService: AgentLookup;
}): Promise<Awaited<ReturnType<AgentLookup["getByIdOrThrow"]>>> => {
  try {
    return await agentService.getByIdOrThrow({ id: spec.agentId, projectId });
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      throw new ComparisonVariantAgentNotFoundError(spec.agentId, {
        reasons: [error],
      });
    }
    throw error;
  }
};

/**
 * An `agent:<id>` variant. HTTP agents carry a request config the workbench
 * builds a target from; every other kind maps its declared inputs and outputs
 * straight across.
 */
const resolveAgentVariant = async ({
  spec,
  projectId,
  agentService,
  resolution,
}: {
  spec: Extract<VariantSpec, { kind: "agent" }>;
  projectId: string;
  agentService: AgentLookup;
  resolution: VariantResolution;
}): Promise<TargetConfig> => {
  const agent = await loadVariantAgent({ spec, projectId, agentService });

  const existing = resolution.allTargets.find(
    (t) => t.type === "agent" && t.dbAgentId === agent.id,
  );
  if (existing) {
    resolution.reusedTargetIds.push(existing.id);
    return existing;
  }

  const config = agent.config as {
    inputs?: Field[];
    outputs?: Field[];
  } & Partial<HttpComponentConfig>;

  return adoptNewTarget(
    agent.type === "http"
      ? buildHttpAgentTarget({
          id: `target_${nanoid()}`,
          dbAgentId: agent.id,
          httpConfig: convertHttpComponentConfig(config as HttpComponentConfig),
        })
      : {
          id: `target_${nanoid()}`,
          type: "agent",
          agentType: agent.type,
          dbAgentId: agent.id,
          inputs: config.inputs?.length ? config.inputs : [DEFAULT_INPUT],
          outputs: config.outputs?.length ? config.outputs : [DEFAULT_OUTPUT],
          mappings: {},
        },
    resolution,
    spec,
  );
};

/**
 * Resolve one variant spec against the experiment's current targets, creating
 * a new target only when no matching one already exists. Appends to the
 * accumulators in `resolution`, which `attachComparison` owns.
 */
const resolveVariant = async ({
  spec,
  projectId,
  promptService,
  agentService,
  resolution,
}: {
  spec: VariantSpec;
  projectId: string;
  promptService: PromptLookup;
  agentService: AgentLookup;
  resolution: VariantResolution;
}): Promise<TargetConfig> => {
  switch (spec.kind) {
    case "existingTarget":
      return resolveExistingTargetVariant(spec, resolution);
    case "prompt":
      return resolvePromptVariant({
        spec,
        projectId,
        promptService,
        resolution,
      });
    case "agent":
      return resolveAgentVariant({ spec, projectId, agentService, resolution });
  }
};

/**
 * Auto-map a freshly-created target's inputs to dataset columns (mirrors
 * the store's addTarget behavior), then fail fast if a genuinely required
 * input still has nowhere to come from — better than persisting a
 * comparison whose variant can never produce an output.
 */
const finishNewTarget = (
  target: TargetConfig,
  datasets: DatasetReference[],
  spec: Extract<VariantSpec, { kind: "prompt" | "agent" }>,
): void => {
  target.mappings = inferAllTargetMappings(target, datasets);

  for (const dataset of datasets) {
    const validation = getTargetMissingMappings(target, dataset.id);
    const missingRequired = validation.missingMappings.filter(
      (m) => m.isRequired,
    );
    if (missingRequired.length > 0) {
      throw new ComparisonVariantUnmappableError({
        variant:
          spec.kind === "prompt"
            ? `prompt:${spec.handle}`
            : `agent:${spec.agentId}`,
        fields: missingRequired.map((m) => m.fieldName),
        datasetId: dataset.id,
      });
    }
  }
};

type PromptLookup = Pick<PromptService, "getPromptByIdOrHandle">;
type AgentLookup = Pick<AgentService, "getByIdOrThrow">;
type EvaluatorLookup = Pick<
  EvaluatorService,
  "getAllWithFields" | "createWithDefaults" | "enrichWithFields"
>;

/**
 * Resolves every variant spec against the experiment's targets, creating the
 * ones that are missing, and returns the distinct target ids the comparison
 * will judge between.
 *
 * Two specs can land on the same underlying target (an explicit duplicate, or
 * a `prompt:`/`agent:` spec naming a target already referenced via `target:`),
 * so the ids are deduped and then required to still number at least two: a
 * comparison of a target against itself has no verdict to give.
 */
const resolveVariantTargets = async ({
  specs,
  projectId,
  promptService,
  agentService,
  resolution,
}: {
  specs: readonly VariantSpec[];
  projectId: string;
  promptService: PromptLookup;
  agentService: AgentLookup;
  resolution: VariantResolution;
}): Promise<string[]> => {
  const variantTargetIds: string[] = [];

  for (const spec of specs) {
    const resolved = await resolveVariant({
      spec,
      projectId,
      promptService,
      agentService,
      resolution,
    });

    if (isComparisonEvaluator(resolved)) {
      throw new ComparisonVariantIsComparisonError(resolved.id);
    }

    variantTargetIds.push(resolved.id);
  }

  const uniqueVariantIds = [...new Set(variantTargetIds)];
  if (uniqueVariantIds.length < 2) {
    throw new ComparisonVariantsNotDistinctError(uniqueVariantIds);
  }
  return uniqueVariantIds;
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
