import {
  type ElasticSearchSpan,
  type Trace,
} from "../../../server/tracer/types";
import { runPiiCheck } from "./piiCheck";
import { env } from "../../../env.mjs";

export const cleanupPII = async (
  trace: Trace,
  spans: ElasticSearchSpan[]
): Promise<undefined> => {
  const piiEnforced = env.NODE_ENV === "production";
  const results = await runPiiCheck(trace, spans, piiEnforced);
  const { quotes } = results;

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
