import { EvaluationExecutionMode } from "@prisma/client";
import crypto from "crypto";
import slugify from "slugify";
import type { EvaluatorTypes } from "../../../../server/evaluations/evaluators.generated";
import {
  evaluatePreconditions,
  type PreconditionTrace,
} from "../../../../server/evaluations/preconditions";
import type { CheckPreconditions } from "../../../../server/evaluations/types";
import { getDebugger } from "../../../../utils/logger";
import { prisma } from "../../../db";
import type { ElasticSearchEvaluation } from "../../../tracer/types";
import { type ElasticSearchTrace, type Span } from "../../../tracer/types";
import { elasticSearchEvaluationSchema } from "../../../tracer/types.generated";
import { scheduleEvaluation } from "../../queues/evaluationsQueue";
import type { CollectorJob, EvaluationJob } from "../../types";

export const evaluationNameAutoslug = (name: string) => {
  const autoslug = slugify(name || "unnamed", {
    lower: true,
    strict: true,
  }).replace(/[^a-z0-9]/g, "_");
  return `custom_eval_${autoslug}`;
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
        evaluation.evaluator_id ?? evaluationNameAutoslug(evaluation.name),
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

export const scheduleEvaluations = async (
  trace: EvaluationJob["trace"] & PreconditionTrace,
  spans: Span[]
) => {
  const isOutputEmpty = !trace.output?.value;
  const lastOutput = spans.reverse()[0]?.output;
  const blockedByGuardrail =
    isOutputEmpty &&
    lastOutput?.type === "guardrail_result" &&
    lastOutput?.value?.passed === false;
  if (blockedByGuardrail) {
    return;
  }

  const checks = await prisma.check.findMany({
    where: {
      projectId: trace.project_id,
      enabled: true,
      executionMode: EvaluationExecutionMode.ON_MESSAGE,
    },
  });

  const traceChecksSchedulings = [];
  for (const check of checks) {
    if (Math.random() <= check.sample) {
      const preconditions = (check.preconditions ?? []) as CheckPreconditions;
      const preconditionsMet = evaluatePreconditions(
        check.checkType,
        trace,
        spans,
        preconditions
      );
      if (preconditionsMet) {
        traceChecksSchedulings.push(
          scheduleEvaluation({
            check: {
              evaluation_id: check.id, // Keep the same as evaluator id so multiple jobs for this trace will update the same evaluation state
              evaluator_id: check.id,
              type: check.checkType as EvaluatorTypes,
              name: check.name,
            },
            trace: trace,
          })
        );
      }
    }
  }

  await Promise.all(traceChecksSchedulings);
};
