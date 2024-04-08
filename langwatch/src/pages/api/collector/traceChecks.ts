import { scheduleTraceCheck } from "../../../server/background/queues/traceChecksQueue";
import { prisma } from "../../../server/db";
import { type Span, type Trace } from "../../../server/tracer/types";
import type { EvaluatorTypes } from "../../../trace_checks/evaluators.generated";
import { evaluatePreconditions } from "../../../trace_checks/preconditions";
import type { CheckPreconditions } from "../../../trace_checks/types";
import { debug } from "../collector";

export const scheduleTraceChecks = async (trace: Trace, spans: Span[]) => {
  const isOutputEmpty = !trace.output?.value;
  const lastOutput = spans.reverse()[0]?.outputs[0];
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
      checkType: { not: "pii_check" },
    },
  });

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
        void scheduleTraceCheck({
          check: {
            ...check,
            type: check.checkType as EvaluatorTypes,
          },
          trace: trace,
        });
      }
    }
  }
};
