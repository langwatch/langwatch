import {
  EvaluationBusyError,
  EvaluatorExecutionError,
  EvaluatorInputTooLargeError,
  EvaluatorNotFoundError,
} from "@langwatch/evaluation-contract";
import { findEvaluatorDefinitions } from "@langwatch/evaluator-contract";
import { EvaluatorConfigError } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import { PayloadTooLargeError } from "../../../channels/langevals.channel.ts";
import { handledCodeForRuntimeRefusal } from "../../../rules/evaluator-runtime-engine.rules.ts";
import type { EvaluationExecutionMetricsService } from "../../execution/services/evaluation-execution-metrics.service.ts";

const logger = createLogger("langwatch:langevals-http-client");
/** LangEvals not up yet (still booting, or restarting): the queue retries the evaluation. */
const NOT_UP_YET = { httpStatus: 503, retryable: true } as const;
/** What a synchronous caller is told to wait (`Retry-After`) before asking again. */
const NOT_UP_YET_RETRY_AFTER_MS = 5_000;
/** The evaluator service, or the gateway in front of it, gave up waiting: never retried. */
export const TIMED_OUT_STATUS = 504;

export function throwFetchFailure({
  error,
  url,
  timeoutMs,
  evaluatorType,
  onTooLarge,
}: {
  error: unknown;
  url: string;
  timeoutMs: number;
  evaluatorType: string;
  onTooLarge: () => void;
}): never {
  if (error instanceof PayloadTooLargeError) {
    onTooLarge();
    throw new EvaluatorInputTooLargeError({ meta: { evaluatorType } });
  }

  if (error instanceof Error && error.name === "AbortError") {
    logger.warn({ url, timeoutMs }, "Evaluator request timed out");
    // The address dialled stays in the log line above: `meta` rides the
    // experiment SSE stream to the browser, and it is a deployment's own
    // internal service address.
    throw new EvaluatorExecutionError(`Evaluator timed out after ${timeoutMs}ms`, {
      meta: { evaluatorType, timeoutMs },
    });
  }

  if (error instanceof Error && error.message.includes("fetch failed")) {
    logger.warn({ error, url }, "Evaluator cannot be reached");
    throw new EvaluatorExecutionError("Evaluator cannot be reached", {
      meta: { evaluatorType, retryAfterMs: NOT_UP_YET_RETRY_AFTER_MS },
      ...NOT_UP_YET,
    });
  }

  throw error;
}

/** A built-in the Go runtime answered `evaluator_not_found` for, as `runtimeRefusal` builds it. */
export function isUnservedByRuntime(error: unknown): boolean {
  return (
    error instanceof EvaluatorExecutionError && error.meta?.runtimeCode === "evaluator_not_found"
  );
}

export type EvaluationTelemetry = Pick<EvaluationExecutionMetricsService, "record">;

/** herr's body, as the Go evaluator runtime refuses a call. */
const runtimeRefusalSchema = z.object({
  error: z.object({
    code: z.string(),
    meta: z.object({ retryAfterMs: z.number().optional() }).loose().optional(),
  }),
});

/** The handled error a Go runtime refusal becomes, recorded and logged without its body. */
async function runtimeRefusal({
  response,
  evaluatorType,
  telemetry,
  durationMs,
}: {
  response: Response;
  evaluatorType: string;
  telemetry: EvaluationTelemetry | undefined;
  durationMs: number;
}): Promise<Error> {
  const refusal = runtimeRefusalSchema.safeParse(await response.json().catch(() => undefined));
  const code = refusal.success ? refusal.data.error.code : undefined;
  const retryAfterMs = refusal.success ? refusal.data.error.meta?.retryAfterMs : undefined;
  const handledCode = handledCodeForRuntimeRefusal({ code });
  logger.warn(
    { evaluatorType, httpStatus: response.status, code },
    "Evaluator runtime refused the call",
  );
  telemetry?.record({
    evaluatorType,
    status: handledCode === "evaluator_input_too_large" ? "skipped" : "error",
    durationMs,
  });

  switch (handledCode) {
    case "evaluator_not_found":
      if (findEvaluatorDefinitions(evaluatorType).length === 0) {
        return new EvaluatorNotFoundError(evaluatorType);
      }
      // A built-in routed to Go before Go ports it is our routing fault, never a customer skip.
      return new EvaluatorExecutionError("The evaluator runtime does not serve this evaluator", {
        meta: { evaluatorType, runtimeCode: "evaluator_not_found" },
      });
    case "evaluator_config_error":
      return new EvaluatorConfigError("The evaluator's settings were refused", {
        meta: { evaluatorType },
      });
    case "evaluator_input_too_large":
      return new EvaluatorInputTooLargeError({ meta: { evaluatorType } });
    case "evaluation_busy":
      return new EvaluationBusyError({ evaluatorType, retryAfterMs });
    case "evaluator_execution_error":
      return new EvaluatorExecutionError("The evaluator runtime refused the call", {
        meta: {
          evaluatorType,
          runtimeCode: code ?? "unknown",
          ...(response.status === 503 ? { retryAfterMs: NOT_UP_YET_RETRY_AFTER_MS } : {}),
        },
        ...(response.status === 503 ? NOT_UP_YET : {}),
      });
  }
}

/** The error a non-retried refusal becomes: Go's herr code, or langevals' status and body. */
export async function refusedCall({
  response,
  engine,
  evaluatorType,
  telemetry,
  durationMs,
}: {
  response: Response;
  engine: "python" | "go";
  evaluatorType: string;
  telemetry: EvaluationTelemetry | undefined;
  durationMs: number;
}): Promise<Error> {
  if (engine === "go") return runtimeRefusal({ response, evaluatorType, telemetry, durationMs });

  let statusText = response.statusText;
  try {
    statusText = JSON.stringify(await response.json(), undefined, 2);
  } catch {
    // The status text remains the meaningful response summary.
  }

  if (response.status === 413) {
    telemetry?.record({ evaluatorType, status: "skipped", durationMs });
    return new EvaluatorInputTooLargeError({
      meta: { evaluatorType, httpStatus: response.status },
    });
  }

  telemetry?.record({ evaluatorType, status: "error", durationMs });
  const timedOut = response.status === TIMED_OUT_STATUS ? "Evaluator timed out: " : "";
  return new EvaluatorExecutionError(`${timedOut}${response.status} ${statusText}`, {
    meta: {
      evaluatorType,
      httpStatus: response.status,
      ...(response.status === 503 ? { retryAfterMs: NOT_UP_YET_RETRY_AFTER_MS } : {}),
    },
    ...(response.status === 503 ? NOT_UP_YET : {}),
  });
}
