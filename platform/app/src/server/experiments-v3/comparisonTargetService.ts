/**
 * Builds and attaches a "comparison" evaluator target to an experiments-v3
 * workbench state from a CLI/API-key-authenticated request.
 *
 * A comparison is not a distinct target type — it is an `evaluator` target
 * whose `targetEvaluatorId` points at a `langevals/select_best_compare` row
 * and whose `comparison` config lists the other targets ("variants") it
 * judges between. Until now the only place that shape was assembled was
 * inline JSX/handler code in EvaluationsV3Table.tsx, reachable only via a
 * session-authenticated browser flow.
 *
 * Must work correctly against an experiment that already has targets, not
 * just a fresh one: referencing a prompt/agent that's already a target in
 * this experiment reuses that target rather than creating a duplicate column.
 */
import { nanoid } from "nanoid";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Field } from "~/optimization_studio/types/dsl";
import type { HttpComponentConfig } from "~/optimization_studio/types/dsl";
import {
  COMPARISON_EVALUATOR_TYPE,
  isComparisonEvaluator,
  isGoldenFieldSatisfied,
  type ComparisonEvaluatorConfig,
  type DatasetReference,
  type TargetConfig,
} from "~/experiments-v3/types";
import {
  deriveComparisonTargetMappings,
  inferAllTargetMappings,
} from "~/experiments-v3/utils/mappingInference";
import { getTargetMissingMappings } from "~/experiments-v3/utils/mappingValidation";
import {
  buildHttpAgentTarget,
  convertHttpComponentConfig,
} from "~/experiments-v3/utils/httpAgentUtils";
import { AgentService } from "~/server/agents/agent.service";
import { AgentNotFoundError } from "~/server/agents/errors";
import { EvaluatorService } from "~/server/evaluators/evaluator.service";
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
  // Deliberately no .min(2) here: a zod schema failure returns Hono's raw
  // { success: false, error: ZodError } envelope, a different shape from
  // every other error this route returns ({ error: string }). The <2 check
  // (covering both "too few given" and "resolved to fewer than 2 distinct
  // targets") happens in attachComparison() instead, so callers only ever
  // see one error shape.
  variants: z.array(variantSpecSchema),
  goldenField: z.string().optional(),
  hasGoldenAnswer: z.boolean().optional(),
  inputField: z.string().optional(),
  includeMetrics: z.array(z.enum(["cost", "duration"])).optional(),
  randomizeOrder: z.boolean().optional(),
});
export type AttachComparisonBody = z.infer<typeof attachComparisonBodySchema>;

export class ComparisonTargetError extends Error {
  readonly status: 400 | 404;
  constructor(message: string, status: 400 | 404 = 400) {
    super(message);
    this.name = "ComparisonTargetError";
    this.status = status;
  }
}

export type AttachComparisonResult = {
  targets: TargetConfig[];
  comparisonTargetId: string;
  createdTargetIds: string[];
  reusedTargetIds: string[];
};

const DEFAULT_INPUT: Field = { identifier: "input", type: "str" };
const DEFAULT_OUTPUT: Field = { identifier: "output", type: "str" };

const describeTargets = (targets: TargetConfig[]): string =>
  targets.length > 0
    ? targets.map((t) => `${t.id} (${t.type})`).join(", ")
    : "none";

/**
 * Resolve one variant spec against the experiment's current targets,
 * creating a new target only when no matching one already exists. Mutates
 * `allTargets`/`createdTargetIds`/`reusedTargetIds` in place — kept private
 * to attachComparison, which owns those accumulators.
 */
const resolveVariant = async ({
  spec,
  projectId,
  allTargets,
  datasets,
  promptService,
  agentService,
  createdTargetIds,
  reusedTargetIds,
}: {
  spec: VariantSpec;
  projectId: string;
  allTargets: TargetConfig[];
  datasets: DatasetReference[];
  promptService: PromptLookup;
  agentService: AgentLookup;
  createdTargetIds: string[];
  reusedTargetIds: string[];
}): Promise<TargetConfig> => {
  if (spec.kind === "existingTarget") {
    const found = allTargets.find((t) => t.id === spec.targetId);
    if (!found) {
      throw new ComparisonTargetError(
        `Target "${spec.targetId}" not found in this experiment. Current targets: ${describeTargets(allTargets)}`,
      );
    }
    return found;
  }

  if (spec.kind === "prompt") {
    const prompt = await promptService.getPromptByIdOrHandle({
      idOrHandle: spec.handle,
      projectId,
      version: spec.version,
    });
    if (!prompt) {
      throw new ComparisonTargetError(`Prompt "${spec.handle}" not found`, 404);
    }

    const existing = allTargets.find(
      (t) =>
        t.type === "prompt" &&
        t.promptId === prompt.id &&
        (spec.version === undefined || t.promptVersionNumber === prompt.version),
    );
    if (existing) {
      reusedTargetIds.push(existing.id);
      return existing;
    }

    const newTarget: TargetConfig = {
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
    };
    finishNewTarget(newTarget, datasets, spec);
    allTargets.push(newTarget);
    createdTargetIds.push(newTarget.id);
    return newTarget;
  }

  // spec.kind === "agent"
  let agent: Awaited<ReturnType<AgentLookup["getByIdOrThrow"]>>;
  try {
    agent = await agentService.getByIdOrThrow({ id: spec.agentId, projectId });
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      throw new ComparisonTargetError(`Agent "${spec.agentId}" not found`, 404);
    }
    throw error;
  }

  const existing = allTargets.find(
    (t) => t.type === "agent" && t.dbAgentId === agent.id,
  );
  if (existing) {
    reusedTargetIds.push(existing.id);
    return existing;
  }

  const config = agent.config as {
    inputs?: Field[];
    outputs?: Field[];
  } & Partial<HttpComponentConfig>;

  const newTarget: TargetConfig =
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
        };
  finishNewTarget(newTarget, datasets, spec);
  allTargets.push(newTarget);
  createdTargetIds.push(newTarget.id);
  return newTarget;
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
      const fields = missingRequired.map((m) => m.fieldName).join(", ");
      const describedSpec =
        spec.kind === "prompt" ? `prompt:${spec.handle}` : `agent:${spec.agentId}`;
      throw new ComparisonTargetError(
        `Cannot map required input(s) [${fields}] for the new target built from ${describedSpec} to any dataset column. Add a matching column to the dataset, or reference an existing target instead.`,
      );
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
  if (datasets.length === 0) {
    throw new ComparisonTargetError("No dataset configured");
  }
  if (body.variants.length < 2) {
    throw new ComparisonTargetError(
      "At least two variants are required to build a comparison",
    );
  }

  const activeDataset =
    datasets.find((d) => d.id === activeDatasetId) ?? datasets[0];

  const allTargets = [...targets];
  const createdTargetIds: string[] = [];
  const reusedTargetIds: string[] = [];
  const variantTargetIds: string[] = [];

  const promptService = services?.promptService ?? new PromptService(prisma);
  const agentService = services?.agentService ?? AgentService.create(prisma);

  for (const spec of body.variants) {
    const resolved = await resolveVariant({
      spec,
      projectId,
      allTargets,
      datasets,
      promptService,
      agentService,
      createdTargetIds,
      reusedTargetIds,
    });

    if (isComparisonEvaluator(resolved)) {
      throw new ComparisonTargetError(
        `Target "${resolved.id}" is itself a comparison and cannot be used as a variant of another comparison`,
      );
    }

    variantTargetIds.push(resolved.id);
  }

  // Two --variant specs can resolve to the same underlying target (e.g. an
  // explicit duplicate, or a `prompt:`/`agent:` spec that reuses a target
  // already referenced via `target:`). Dedupe rather than silently building
  // a "compare X against itself" comparison, then require at least two
  // distinct candidates remain — a comparison needs real variety.
  const uniqueVariantIds = [...new Set(variantTargetIds)];
  if (uniqueVariantIds.length < 2) {
    throw new ComparisonTargetError(
      "At least two distinct variants are required to build a comparison — the given variants resolved to the same target.",
    );
  }

  // goldenField/inputField are free-text in the request (unlike the UI's
  // dropdown, which can only ever offer real columns). A typo here would
  // otherwise persist silently and only surface as a missing value at run
  // time, well after the caller has moved on.
  for (const [label, field] of [
    ["goldenField", body.goldenField],
    ["inputField", body.inputField],
  ] as const) {
    if (field && !activeDataset!.columns.some((c) => c.name === field)) {
      throw new ComparisonTargetError(
        `${label} "${field}" is not a column on dataset "${activeDataset!.id}". Available columns: ${activeDataset!.columns.map((c) => c.name).join(", ") || "none"}`,
      );
    }
  }

  const hasGoldenAnswer = body.hasGoldenAnswer ?? !!body.goldenField;
  const comparisonConfig: ComparisonEvaluatorConfig = {
    variants: uniqueVariantIds,
    hasGoldenAnswer,
    goldenField: body.goldenField,
    inputField: body.inputField,
    includeMetrics: [...new Set(body.includeMetrics ?? [])],
    randomizeOrder: body.randomizeOrder ?? true,
  };

  if (!isGoldenFieldSatisfied(comparisonConfig)) {
    throw new ComparisonTargetError(
      "hasGoldenAnswer is true but no golden field was provided",
    );
  }

  const evaluatorService =
    services?.evaluatorService ?? EvaluatorService.create(prisma);
  const existingEvaluators = await evaluatorService.getAllWithFields({
    projectId,
  });
  let comparisonEvaluator = existingEvaluators.find((e) => {
    const config = e.config as { evaluatorType?: string } | null;
    return config?.evaluatorType === COMPARISON_EVALUATOR_TYPE;
  });

  if (!comparisonEvaluator) {
    const created = await evaluatorService.createWithDefaults({
      id: `evaluator_${nanoid()}`,
      projectId,
      name: "Comparison",
      type: "evaluator",
      config: { evaluatorType: COMPARISON_EVALUATOR_TYPE },
    });
    comparisonEvaluator = await evaluatorService.enrichWithFields(created);
  }

  const comparisonTargetId = `target_${nanoid()}`;
  const comparisonTarget: TargetConfig = {
    id: comparisonTargetId,
    type: "evaluator",
    targetEvaluatorId: comparisonEvaluator.id,
    inputs: comparisonEvaluator.fields.map((f) => ({
      identifier: f.identifier,
      type: f.type as Field["type"],
      ...(f.optional && { optional: true }),
    })),
    outputs: comparisonEvaluator.outputFields.map((f) => ({
      identifier: f.identifier,
      type: f.type as Field["type"],
    })),
    mappings: activeDataset
      ? { [activeDataset.id]: deriveComparisonTargetMappings(comparisonConfig, activeDataset) }
      : {},
    comparison: comparisonConfig,
  };

  allTargets.push(comparisonTarget);

  return {
    targets: allTargets,
    comparisonTargetId,
    createdTargetIds,
    reusedTargetIds,
  };
};
