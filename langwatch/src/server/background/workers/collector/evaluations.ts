import type { ElasticSearchEvaluation } from "../../../tracer/types";
import type { CollectorJob } from "../../types";
import { elasticSearchEvaluationSchema } from "../../../tracer/types.generated";
import crypto from "crypto";

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
      trace_id: data.traceId,
      project_id: data.projectId,
      check_id: evaluation.evaluation_id ?? `eval_md5_${evaluationMD5}`,
      check_type: evaluation.type,
      check_name: evaluation.name,
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

  const uniqueByCheckIdKeepingLast = evaluations
    ?.reverse()
    .filter(
      (evaluation, index, self) =>
        index === self.findIndex((t) => t.check_id === evaluation.check_id)
    )
    .reverse();

  return uniqueByCheckIdKeepingLast;
};
