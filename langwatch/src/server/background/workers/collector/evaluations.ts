import { EvaluationExecutionMode } from "@prisma/client";
import crypto from "node:crypto";
import type { EvaluatorTypes } from "~/server/evaluations/evaluators.generated";
import {
  evaluatePreconditions,
  type PreconditionTrace,
} from "../../../../server/evaluations/preconditions";
import type { CheckPreconditions } from "../../../../server/evaluations/types";
import { createLogger } from "../../../../utils/logger";
import { slugify } from "../../../../utils/slugify";
import { prisma } from "../../../db";
import type { ElasticSearchEvaluation, Span } from "../../../tracer/types";
import { elasticSearchEvaluationSchema } from "../../../tracer/types.generated";
import { scheduleEvaluation } from "../../queues/evaluationsQueue";
import type { CollectorJob, EvaluationJob } from "../../types";

const _logger = createLogger("langwatch:workers:collector:evaluations");

export const evaluationNameAutoslug = (name: string) => {
  const autoslug = slugify(name || "unnamed", {
    lower: true,
    strict: true,
  }).replace(/[^a-z0-9]/g, "_");
  return `customeval_${autoslug}`;
};

export const mapEvaluations = (
  data: CollectorJob,
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
      ?.toReversed()
      .filter(
        (evaluation, index, self) =>
          evaluation &&
          index ===
            self.findIndex((t) => t.evaluation_id === evaluation.evaluation_id),
      )
      .toReversed();

  return uniqueByCheckIdKeepingLast;
};

export const scheduleEvaluations = async (
  trace: EvaluationJob["trace"] & PreconditionTrace,
  spans: Span[],
) => {
  const isOutputEmpty = !trace.output?.value;
  const lastOutput = spans.toReversed()[0]?.output;
  const blockedByGuardrail =
    isOutputEmpty &&
    lastOutput?.type === "guardrail_result" &&
    lastOutput?.value?.passed === false;
  if (blockedByGuardrail) {
    return;
  }

  const checks = await prisma.monitor.findMany({
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
        preconditions,
      );
      if (preconditionsMet) {
        // Check if this is a thread-level evaluation with idle timeout
        const hasThreadIdleTimeout = check.threadIdleTimeout !== null && check.threadIdleTimeout > 0;
        const threadId = trace.thread_id ?? (trace.metadata as { thread_id?: string } | undefined)?.thread_id;

        traceChecksSchedulings.push(
          scheduleEvaluation({
            check: {
              evaluation_id: check.id, // Keep the same as evaluator id so multiple jobs for this trace will update the same evaluation state
              evaluator_id: check.id,
              type: check.checkType as EvaluatorTypes,
              name: check.name,
            },
            trace: trace,
            // Thread-based debouncing: use thread ID + monitor ID as job key
            // and delay by threadIdleTimeout seconds
            threadDebounce: hasThreadIdleTimeout && threadId ? {
              threadId,
              timeoutSeconds: check.threadIdleTimeout!,
            } : undefined,
          }),
        );
      }
    }
  }

  await Promise.all(traceChecksSchedulings);
};
