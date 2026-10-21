import type { ChartQueryError } from "@langwatch/analytics-contract/chart-frame-protocol";
import {
  type ErrorExplanation,
  explainHandledError,
  UNKNOWN_ERROR_PRESENTATION,
} from "@langwatch/handled-error/presentation";

/** What a chart query failure reads as: the registry's words plus the error id to quote. */
export type ChartQueryErrorExplanation = ErrorExplanation & { traceId: string | undefined };

/**
 * The registry's words for a chart query failure, read by code and meta, never off `message`
 * where the registry has an entry: the failure crossed the frame boundary, so its prose is not
 * ours to trust. An unworded code falls back to the executor's sentence (server remediation).
 */
export function explainChartQueryError(
  error: Pick<ChartQueryError, "code" | "meta" | "retryable"> &
    Partial<Pick<ChartQueryError, "message" | "traceId">>,
): ChartQueryErrorExplanation {
  const traceId = error.traceId;
  const carried = error.message?.trim() ?? "";

  const explanation =
    error.code === "unknown"
      ? UNKNOWN_ERROR_PRESENTATION
      : explainHandledError({
          code: error.code,
          meta: { ...error.meta },
          httpStatus: 422,
          fault: "customer",
          retryable: error.retryable === true,
          tips: [],
          docsUrl: undefined,
          traceId: undefined,
          reasons: [],
        });

  if (explanation.isRegistered || !carried) return { ...explanation, traceId };

  return { ...explanation, description: carried, traceId };
}

/** A chart query failure for a code, with the registry's words filled in for the frame. */
export function chartQueryErrorFor({
  code,
  meta,
}: {
  code: string;
  meta: Readonly<Record<string, unknown>>;
}): ChartQueryError {
  const { title, description } = explainChartQueryError({ code, meta });

  return { code, title, message: description, meta };
}
