import { scheduleTraceCheck } from "../../queues/traceChecksQueue";
import { prisma } from "../../../db";
import { type ElasticSearchTrace, type Span } from "../../../tracer/types";
import type { EvaluatorTypes } from "../../../../trace_checks/evaluators.generated";
import { evaluatePreconditions } from "../../../../trace_checks/preconditions";
import type { CheckPreconditions } from "../../../../trace_checks/types";
import { getDebugger } from "../../../../utils/logger";
import { EvaluationExecutionMode } from "@prisma/client";

const debug = getDebugger("langwatch:traceChecks");

export const scheduleTraceChecks = async (
  trace: ElasticSearchTrace,
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
        debug(
          `scheduling ${check.checkType} (checkId: ${check.id}) for trace ${trace.trace_id}`
        );
        traceChecksSchedulings.push(
          scheduleTraceCheck({
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
