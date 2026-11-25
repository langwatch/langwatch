/**
 * The value rules an SDK batch result log applies before a row is recorded:
 * the verdict fields a run may publish, and the batch's targets.
 * @see specs/monitors/guardrails-api-compatibility.feature
 */
import {
  eSBatchEvaluationTargetTypeSchema,
  type ESBatchEvaluationRESTParams,
  type ESBatchEvaluationTarget,
  type ESBatchEvaluationTargetType,
} from "@langwatch/experiment-contract";

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
  metadata: Record<string, string | number | boolean> | null;
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

  if (!metadata) {
    // Unreachable: `declared` is only a defined string when `metadata` was
    // truthy and carried its own `type` field.
    throw new Error(`Invalid target type '${declared}': no metadata to promote it from`);
  }

  const { type: _promoted, ...rest } = metadata;

  return { type: parsed.data, metadata: Object.keys(rest).length > 0 ? rest : null };
}

/**
 * An SDK batch's targets, with a `type` carried in `metadata` promoted to the
 * target's own field. Null where the batch named no targets at all.
 */
export const normalizeTargets = (
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
