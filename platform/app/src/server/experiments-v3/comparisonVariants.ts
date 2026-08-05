/**
 * Resolving a comparison's `--variant` specs into concrete experiment targets.
 *
 * A variant either names a target the experiment already has, or names a
 * prompt or agent that has to become one. Resolving is where an experiment
 * that already has targets is kept honest: a prompt or agent that is already
 * a target is reused rather than gaining a second column for the same thing.
 *
 * Everything here appends to the caller's `VariantResolution`, which
 * `attachComparison` owns and reports back to the caller.
 */
import { nanoid } from "nanoid";
import {
  type DatasetReference,
  isComparisonEvaluator,
  type TargetConfig,
} from "~/experiments-v3/types";
import {
  buildHttpAgentTarget,
  convertHttpComponentConfig,
} from "~/experiments-v3/utils/httpAgentUtils";
import { inferAllTargetMappings } from "~/experiments-v3/utils/mappingInference";
import { getTargetMissingMappings } from "~/experiments-v3/utils/mappingValidation";
import type {
  Field,
  HttpComponentConfig,
} from "~/optimization_studio/types/dsl";
import type { AgentService } from "~/server/agents/agent.service";
import { AgentNotFoundError } from "~/server/agents/errors";
import type { EvaluatorService } from "~/server/evaluators/evaluator.service";
import {
  ComparisonVariantAgentNotFoundError,
  ComparisonVariantIsComparisonError,
  ComparisonVariantsNotDistinctError,
  ComparisonVariantTargetNotFoundError,
  ComparisonVariantUnmappableError,
} from "~/server/experiments-v3/errors";
import { NotFoundError as PromptNotFoundError } from "~/server/prompt-config/errors/not-found-error";
import type { PromptService } from "~/server/prompt-config/prompt.service";
import type { VariantSpec } from "./comparisonTargetService";

export type PromptLookup = Pick<PromptService, "getPromptByIdOrHandle">;
export type AgentLookup = Pick<AgentService, "getByIdOrThrow">;
export type EvaluatorLookup = Pick<
  EvaluatorService,
  "getAllWithFields" | "createWithDefaults" | "enrichWithFields"
>;

const DEFAULT_INPUT: Field = { identifier: "input", type: "str" };
const DEFAULT_OUTPUT: Field = { identifier: "output", type: "str" };

/**
 * The accumulators `attachComparison` owns and every resolver appends to: the
 * running target list plus the two id lists the response reports back, so a
 * caller can see what was built for it and what was already there.
 */
export type VariantResolution = {
  allTargets: TargetConfig[];
  datasets: DatasetReference[];
  /** The one dataset the comparison maps against, and so the one a new
   * variant target has to be able to read its inputs from. */
  activeDataset: DatasetReference;
  createdTargetIds: string[];
  reusedTargetIds: string[];
};

/** Records a freshly built target against the experiment and the response. */
const adoptNewTarget = (
  target: TargetConfig,
  resolution: VariantResolution,
  spec: Extract<VariantSpec, { kind: "prompt" | "agent" }>,
): TargetConfig => {
  finishNewTarget(target, resolution, spec);
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
      throw new ComparisonVariantAgentNotFoundError({
        agentId: spec.agentId,
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
 * Auto-map a freshly-created target's inputs to dataset columns (mirrors the
 * store's addTarget behavior), then fail fast if a genuinely required input
 * still has nowhere to come from: better than persisting a comparison whose
 * variant can never produce an output.
 *
 * Mappings are inferred across every dataset, the way the store does it, but
 * only the active one is required to satisfy the target. The comparison reads
 * rows from that dataset alone, so a second dataset the experiment carries for
 * other purposes has no say in whether this variant can run.
 */
const finishNewTarget = (
  target: TargetConfig,
  { datasets, activeDataset }: VariantResolution,
  spec: Extract<VariantSpec, { kind: "prompt" | "agent" }>,
): void => {
  target.mappings = inferAllTargetMappings(target, datasets);

  const validation = getTargetMissingMappings(target, activeDataset.id);
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
      datasetId: activeDataset.id,
    });
  }
};

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
export const resolveVariantTargets = async ({
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
