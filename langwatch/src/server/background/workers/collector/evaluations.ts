import type { ElasticSearchEvaluation } from "../../../tracer/types";
import type { CollectorJob } from "../../types";
import { elasticSearchEvaluationSchema } from "../../../tracer/types.generated";
import crypto from "crypto";
import slugify from "slugify";

export const evaluationNameAutoslug = (name: string) => {
  const autoslug = slugify(name || "unnamed", {
    lower: true,
    strict: true,
  }).replace(/[^a-z0-9]/g, "_");
  return autoslug;
};

export const mapEvaluations = (
  data: CollectorJob
): ElasticSearchEvaluation[] | undefined => {
  const evaluations = data.evaluations?.map((evaluation) => {
    const evaluationMD5 = crypto
      .createHash("md5")
      .update(JSON.stringify(evaluation))
      .digest("hex");

    const evaluation_: ElasticSearchEvaluation = {
      ...evaluation,
      evaluation_id: evaluation.evaluation_id ?? `eval_md5_${evaluationMD5}`,
      evaluator_id:
        evaluation.evaluator_id ??
        `custom_eval_${evaluationNameAutoslug(evaluation.name)}`,
      type: evaluation.type,
      name: evaluation.name,
      status: evaluation.status ?? (evaluation.error ? "error" : "processed"),
      timestamps: {
        ...evaluation.timestamps,
        inserted_at: Date.now(),
        updated_at: Date.now(),
      },
    };

    // reparse to remove unwanted extraneous fields
    return elasticSearchEvaluationSchema.parse(evaluation_);
  });

  const uniqueByCheckIdKeepingLast: ElasticSearchEvaluation[] | undefined =
    evaluations
      ?.reverse()
      .filter(
        (evaluation, index, self) =>
          evaluation &&
          index ===
            self.findIndex((t) => t.evaluation_id === evaluation.evaluation_id)
      )
      .reverse();

  return uniqueByCheckIdKeepingLast;
};
