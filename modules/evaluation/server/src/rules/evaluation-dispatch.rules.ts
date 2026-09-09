/**
 * The value rules the public evaluation doors apply before anything is run or
 * recorded: the evaluator's input, the pairwise translation, the verdict fields
 * a run may publish, and an SDK batch's targets.
 */
import {
  AVAILABLE_EVALUATORS,
  CODE_EVALUATOR_CHECK_PREFIX,
  coerceEvaluatorScalar,
  type EvaluatorTypes,
} from "@langwatch/evaluator-contract";
import type { EvaluationDispatchData } from "@langwatch/evaluation-contract";
import {
  eSBatchEvaluationTargetTypeSchema,
  type ESBatchEvaluationRESTParams,
  type ESBatchEvaluationTarget,
  type ESBatchEvaluationTargetType,
} from "@langwatch/experiment-contract";
import { extractChunkTextualContent, rAGChunkSchema } from "@langwatch/trace-contract";
import { z } from "zod";

const coercedString = z.preprocess(coerceEvaluatorScalar, z.string().optional().nullable());

const defaultEvaluatorInputSchema = z.object({
  input: coercedString,
  output: coercedString,
  contexts: z
    .union([z.array(rAGChunkSchema), z.array(z.string())])
    .optional()
    .nullable(),
  expected_output: coercedString,
  expected_contexts: z
    .union([z.array(rAGChunkSchema), z.array(z.string())])
    .optional()
    .nullable(),
  conversation: z
    .array(
      z.object({
        input: coercedString,
        output: coercedString,
      }),
    )
    .optional()
    .nullable(),
});

/** The six canonical fields a built-in evaluator reads its input from. */
const CANONICAL_KEYS: ReadonlySet<string> = new Set([
  "input",
  "output",
  "contexts",
  "expected_output",
  "expected_contexts",
  "conversation",
]);

const autoparseContexts = (contexts: unknown[] | unknown): string[] | undefined => {
  if (contexts === null || contexts === undefined) return undefined;
  const parsedContexts = Array.isArray(contexts) ? contexts : [contexts];

  return parsedContexts.map((context) => {
    if (typeof context === "string") return context;

    return extractChunkTextualContent("content" in context ? context.content : context);
  });
};

export const getEvaluatorDataForParams = (
  checkType: string,
  params: Record<string, any>,
): EvaluationDispatchData => {
  const declaresOwnInputs =
    checkType.startsWith("custom/") || checkType.startsWith(CODE_EVALUATOR_CHECK_PREFIX);

  if (declaresOwnInputs) return { type: "custom", data: params };

  const data_ = defaultEvaluatorInputSchema.parse({
    ...params,
    contexts: autoparseContexts(params.contexts),
    expected_contexts: autoparseContexts(params.expected_contexts),
  });

  // Preserve evaluator-specific fields (e.g. pairwise's candidate_a_id /
  // candidate_a_output) that the legacy default schema strips. Bounded to the
  // evaluator's declared required + optional fields so a stray mapping output
  // on a non-pairwise evaluator can't ride through and trip a strict pydantic
  // model on the langevals side.
  const evaluatorContract = AVAILABLE_EVALUATORS[checkType as EvaluatorTypes];
  const allowedExtras = new Set([
    ...(evaluatorContract?.requiredFields ?? []),
    ...(evaluatorContract?.optionalFields ?? []),
  ]);
  const extras: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (CANONICAL_KEYS.has(key)) continue;
    if (!allowedExtras.has(key)) continue;
    extras[key] = value;
  }

  return {
    type: "default",
    data: {
      ...extras,
      input: data_.input ? data_.input : undefined,
      output: data_.output ? data_.output : undefined,
      contexts: JSON.stringify(data_.contexts),
      expected_output: data_.expected_output ? data_.expected_output : undefined,
      expected_contexts: JSON.stringify(data_.expected_contexts),
      conversation: JSON.stringify(
        data_.conversation?.map((message) => ({
          input: message.input ?? undefined,
          output: message.output ?? undefined,
        })) ?? [],
      ),
    },
  };
};

/**
 * Translates a legacy 2-slot pairwise payload (`candidate_a_id` /
 * `candidate_a_output` / ... `candidate_b_*`) into the N-way `candidates` shape
 * `langevals/select_best_compare` expects.
 */
export const translateLegacyPairwisePayload = (
  data: Record<string, unknown>,
): Record<string, unknown> => {
  const {
    candidate_a_id,
    candidate_a_output,
    candidate_a_cost,
    candidate_a_duration,
    candidate_b_id,
    candidate_b_output,
    candidate_b_cost,
    candidate_b_duration,
    ...rest
  } = data;

  const candidates = [
    candidate_a_id !== undefined
      ? {
          id: candidate_a_id,
          output: candidate_a_output,
          cost: candidate_a_cost,
          duration: candidate_a_duration,
        }
      : undefined,
    candidate_b_id !== undefined
      ? {
          id: candidate_b_id,
          output: candidate_b_output,
          cost: candidate_b_cost,
          duration: candidate_b_duration,
        }
      : undefined,
  ].filter((candidate) => candidate !== undefined);

  return { ...rest, candidates };
};

/**
 * Removes a legacy pairwise `prompt` that select_best_compare cannot render:
 * the N-way judge substitutes only `{candidates}`, `{input}` and `{golden}`.
 */
export const stripIncompatiblePairwisePrompt = (
  settings: Record<string, unknown>,
): { settings: Record<string, unknown>; droppedPrompt: boolean } => {
  if (typeof settings.prompt === "string" && !settings.prompt.includes("{candidates}")) {
    const { prompt: _incompatible, ...rest } = settings;

    return { settings: rest, droppedPrompt: true };
  }

  return { settings, droppedPrompt: false };
};

/**
 * The verdict fields of a `reportEvaluation` payload, gated on the run actually
 * completing: an errored or skipped run's stray passed/score/label must not
 * reach analytics or triggers as a real result (#6833).
 */
export function gatedVerdictFields(result: {
  status: string;
  score?: number | null;
  passed?: boolean | null;
  label?: string | null;
}): { score?: number; passed?: boolean; label?: string } {
  if (result.status !== "processed") return {};

  return {
    score: typeof result.score === "number" ? result.score : undefined,
    passed: result.passed ?? undefined,
    label: result.label ?? undefined,
  };
}

/** The target types an SDK batch may name. */
const VALID_TARGET_TYPES: ESBatchEvaluationTargetType[] = ["prompt", "agent", "custom"];

/** One target's own metadata, minus the `type` promoted out of it. */
type PromotedTarget = Readonly<{
  type: ESBatchEvaluationTargetType;
  metadata: Record<string, unknown> | null;
}>;

/**
 * A batch written before targets carried their own `type` put it in
 * `metadata`; it is promoted here, and refused where it names no known type.
 */
function promoteTargetType(
  target: NonNullable<ESBatchEvaluationRESTParams["targets"]>[number],
): PromotedTarget {
  const metadata = target.metadata;
  const declared = metadata && "type" in metadata ? metadata.type : undefined;

  if (typeof declared !== "string") {
    return { type: target.type ?? "custom", metadata: metadata ?? null };
  }

  const parsed = eSBatchEvaluationTargetTypeSchema.safeParse(declared);

  if (!parsed.success) {
    throw new Error(
      `Invalid target type '${declared}'. Must be one of: ${VALID_TARGET_TYPES.join(", ")}`,
    );
  }

  const { type: _promoted, ...rest } = metadata;

  return { type: parsed.data, metadata: Object.keys(rest).length > 0 ? rest : null };
}

/**
 * An SDK batch's targets, with a `type` carried in `metadata` promoted to the
 * target's own field. Null where the batch named no targets at all.
 */
export const processTargets = (
  targets: ESBatchEvaluationRESTParams["targets"],
): ESBatchEvaluationTarget[] | null => {
  if (!targets || targets.length === 0) return null;

  return targets.map((target) => {
    const promoted = promoteTargetType(target);

    return {
      id: target.id,
      name: target.name,
      type: promoted.type,
      prompt_id: target.prompt_id,
      prompt_version: target.prompt_version,
      agent_id: target.agent_id,
      model: target.model,
      metadata: promoted.metadata,
    };
  });
};
