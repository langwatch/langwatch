/**
 * computeJudgeBiasChecks — the two documented ways an LLM judge's ranking can be wrong
 * that the ranking itself cannot show.
 */

import { type BatchResultRow, extractOutputText } from "./batch-evaluation-results.types";

export type VerbosityProfile = {
  /** Mean output length in characters, per variant. Null when unmeasurable. */
  meanLengthByVariant: Record<string, number | null>;
  /** The leader's mean length over the mean of the other variants'. */
  leaderRatio: number | null;
  /** Mean length of the leader's own outputs. */
  leaderMeanLength: number | null;
  /** Mean length across every variant except the leader. */
  fieldMeanLength: number | null;
  /**
   * The leader the ratio was measured against, or null when the run produced none.
   */
  leaderId: string | null;
};

export type JudgeIndependence = {
  /** The model that actually judged this run, as recorded on the run. */
  judgeModel: string | null;
  /** Provider segment of the judge model, e.g. "openai". */
  judgeFamily: string | null;
  /** Variants running on the judge's own family. */
  sharedFamilyVariantIds: string[];
};

/**
 * Above this, the leader's answers are long enough relative to the field that verbosity
 * is a plausible part of why it won. Chosen as "noticeably longer to a reader", not as
 * a significance threshold — there is no test being run here.
 */
export const VERBOSITY_NOTABLE_RATIO = 1.5;

const meanOf = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;

/** Mean output length for one variant, over the rows it answered with text. */
const meanOutputLength = ({
  rows,
  variantId,
}: {
  rows: BatchResultRow[];
  variantId: string;
}): number | null => {
  const lengths: number[] = [];
  for (const row of rows) {
    const target = row.targets[variantId];
    if (!target || target.error) continue;
    const text = extractOutputText(target.output);
    if (typeof text !== "string" || text.length === 0) continue;
    lengths.push(text.length);
  }
  return meanOf(lengths);
};

/**
 * Mean answer length per variant, and how the leader compares to the rest.
 */
export const computeVerbosityProfile = ({
  variantIds,
  rows,
  leaderId,
}: {
  variantIds: string[];
  rows: BatchResultRow[];
  leaderId: string | null;
}): VerbosityProfile => {
  const meanLengthByVariant: Record<string, number | null> = {};
  for (const variantId of variantIds) {
    meanLengthByVariant[variantId] = meanOutputLength({ rows, variantId });
  }

  const leaderMeanLength = leaderId ? (meanLengthByVariant[leaderId] ?? null) : null;

  const fieldLengths = variantIds
    .filter((id) => id !== leaderId)
    .map((id) => meanLengthByVariant[id])
    .filter((mean): mean is number => mean !== null && mean !== void 0);
  const fieldMeanLength = meanOf(fieldLengths);

  // A zero-length field mean would make the ratio infinite, which is not a
  // reading anyone can act on — report it as unmeasurable instead.
  const leaderRatio =
    leaderMeanLength !== null && fieldMeanLength !== null && fieldMeanLength > 0
      ? leaderMeanLength / fieldMeanLength
      : null;

  return {
    meanLengthByVariant,
    leaderRatio,
    leaderMeanLength,
    fieldMeanLength,
    leaderId: leaderId ?? null,
  };
};

/**
 * Provider segment of a model id ("openai/gpt-5-mini" → "openai").
 */
export const modelFamily = (model: string | null | undefined): string | null => {
  if (!model) return null;
  const [provider] = model.split("/");
  if (!provider || provider === model) return null;
  return provider.toLowerCase();
};

export const computeJudgeIndependence = ({
  judgeModel,
  modelByVariant,
}: {
  judgeModel: string | null;
  modelByVariant: Record<string, string | null | undefined>;
}): JudgeIndependence => {
  const judgeFamily = modelFamily(judgeModel);

  // With no judge family there is nothing to compare against, and listing
  // every variant as "possibly related" would be worse than saying nothing.
  const sharedFamilyVariantIds = judgeFamily
    ? Object.entries(modelByVariant)
        .filter(([, model]) => modelFamily(model) === judgeFamily)
        .map(([variantId]) => variantId)
    : [];

  return {
    judgeModel: judgeModel ?? null,
    judgeFamily,
    sharedFamilyVariantIds,
  };
};
