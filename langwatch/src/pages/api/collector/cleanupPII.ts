import { prisma } from "../../../server/db";
import { type ElasticSearchSpan, type Trace } from "../../../server/tracer/types";
import {
  convertToTraceCheckResult,
  runPiiCheck
} from "../../../trace_checks/backend/piiCheck";
import { updateCheckStatusInES } from "../../../trace_checks/queue";
import type { CheckTypes, Checks } from "../../../trace_checks/types";

// TODO: extract to separate file
export const cleanupPII = async (
  trace: Trace,
  spans: ElasticSearchSpan[]
): Promise<undefined> => {
  const results = await runPiiCheck(trace, spans);
  const { quotes } = results;

  const piiChecks = await prisma.check.findMany({
    where: {
      projectId: trace.project_id,
      enabled: true,
      checkType: "pii_check",
    },
  });

  // PII checks must run on every message anyway for GDPR compliance, however not always the user wants
  // that to fail the trace. So we only update the status if the check is enabled, accordingly to the
  // check configuration, and sampling condition.
  for (const piiCheck of piiChecks) {
    if (piiCheck.sample >= Math.random()) {
      const traceCheckResult = convertToTraceCheckResult(
        results,
        piiCheck.parameters as Checks["pii_check"]["parameters"]
      );
      await updateCheckStatusInES({
        check: {
          ...piiCheck,
          type: piiCheck.checkType as CheckTypes,
        },
        trace: trace,
        status: traceCheckResult.status,
        raw_result: traceCheckResult.raw_result,
        value: traceCheckResult.value,
      });
    }
  }

  for (const quote of quotes) {
    trace.input.value = trace.input.value.replace(quote, "[REDACTED]");
    if (trace.output?.value) {
      trace.output.value = trace.output.value.replace(quote, "[REDACTED]");
    }
    if (trace.error) {
      trace.error.message = trace.error.message.replace(quote, "[REDACTED]");
      // eslint-disable-next-line @typescript-eslint/no-for-in-array
      for (const stacktraceIndex in trace.error.stacktrace) {
        trace.error.stacktrace[stacktraceIndex] =
          trace.error.stacktrace[stacktraceIndex]?.replace(
            quote,
            "[REDACTED]"
          ) ?? "";
      }
    }
    for (const span of spans) {
      if (span.input?.value) {
        span.input.value = span.input.value.replace(quote, "[REDACTED]");
      }
      for (const output of span.outputs) {
        if (output.value) {
          output.value = output.value.replace(quote, "[REDACTED]");
        }
      }
      if (span.error) {
        span.error.message = span.error.message.replace(quote, "[REDACTED]");
        // eslint-disable-next-line @typescript-eslint/no-for-in-array
        for (const stacktraceIndex in span.error.stacktrace) {
          span.error.stacktrace[stacktraceIndex] =
            span.error.stacktrace[stacktraceIndex]?.replace(
              quote,
              "[REDACTED]"
            ) ?? "";
        }
      }
    }
  }
};
