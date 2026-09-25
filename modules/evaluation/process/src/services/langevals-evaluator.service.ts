import { convertTo } from "@langwatch/dataset-contract";
import {
  EvaluatorExecutionError,
  EvaluatorInputTooLargeError,
} from "@langwatch/evaluation-contract";
import {
  batchEvaluationResultSchema,
  type BatchEvaluationResult,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import { createLogger } from "@langwatch/observability";

import {
  type EvaluationLangevals,
  type EvaluationExecutionTelemetry,
  type LangevalsEvaluateParams,
} from "../app/evaluation.members.ts";
import { type LangevalsChannel, PayloadTooLargeError } from "../channels/langevals.channel.ts";

const logger = createLogger("langwatch:langevals-http-client");

function throwFetchFailure({
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
      meta: { evaluatorType },
    });
  }

  throw error;
}

/**
 * What the transport needs from the deployment: where the evaluator service
 * lives, how long a call may take and how many times a 5xx is retried.
 */
export type LangevalsRuntimeConfig = Readonly<{
  endpoint: string | undefined;
  maxRetries: number;
  timeoutMs: number;
}>;

/** Runs one installed evaluator over the langevals channel: retry, timeout and result mapping. */
export class LangevalsEvaluatorService implements EvaluationLangevals {
  static create(input: {
    config: LangevalsRuntimeConfig;
    langevals: LangevalsChannel;
    telemetry?: EvaluationExecutionTelemetry;
  }): LangevalsEvaluatorService {
    return new LangevalsEvaluatorService(input.config, input.langevals, input.telemetry);
  }

  private constructor(
    private readonly config: LangevalsRuntimeConfig,
    private readonly langevals: LangevalsChannel,
    private readonly telemetry: EvaluationExecutionTelemetry | undefined,
  ) {}

  async evaluate(params: LangevalsEvaluateParams): Promise<SingleEvaluationResult> {
    return this.evaluateWithRetry(params, this.config.maxRetries);
  }

  private async evaluateWithRetry(
    params: LangevalsEvaluateParams,
    retriesLeft: number,
  ): Promise<SingleEvaluationResult> {
    const { evaluatorType, data, settings, env, idempotencyKey } = params;
    const url = `${this.config.endpoint}/${evaluatorType}/evaluate`;
    const startTime = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      response = await this.langevals.post({
        url,
        kind: "evaluation",
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
        signal: controller.signal,
        body: {
          data: [
            {
              input: convertTo(data.input, "string"),
              output: convertTo(data.output, "string"),
              contexts: convertTo(data.contexts, "string[]"),
              expected_contexts: convertTo(data.expected_contexts, "string[]"),
              expected_output: convertTo(data.expected_output, "string"),
              conversation: convertTo(data.conversation, "array"),
            },
          ],
          settings: settings ?? {},
          env,
        },
      });
    } catch (error) {
      throwFetchFailure({
        error,
        url,
        timeoutMs: this.config.timeoutMs,
        evaluatorType,
        onTooLarge: () =>
          this.telemetry?.record({
            evaluatorType,
            status: "skipped",
            durationMs: performance.now() - startTime,
          }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      if (response.status >= 500 && retriesLeft > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return this.evaluateWithRetry(params, retriesLeft - 1);
      }

      const duration = performance.now() - startTime;
      let statusText = response.statusText;
      try {
        statusText = JSON.stringify(await response.json(), undefined, 2);
      } catch {
        // The status text remains the meaningful response summary.
      }

      if (response.status === 413) {
        this.telemetry?.record({ evaluatorType, status: "skipped", durationMs: duration });
        throw new EvaluatorInputTooLargeError({
          meta: { evaluatorType, httpStatus: response.status },
        });
      }

      this.telemetry?.record({ evaluatorType, status: "error", durationMs: duration });
      throw new EvaluatorExecutionError(`${response.status} ${statusText}`, {
        meta: { evaluatorType, httpStatus: response.status },
      });
    }

    const duration = performance.now() - startTime;
    let results: BatchEvaluationResult;
    try {
      results = batchEvaluationResultSchema.parse(await response.json());
    } catch (error) {
      this.telemetry?.record({ evaluatorType, status: "error", durationMs: duration });
      throw new EvaluatorExecutionError("Unexpected response: invalid results", {
        meta: { evaluatorType },
        ...(error instanceof Error ? { reasons: [error] } : {}),
      });
    }

    const result = results[0];
    if (!result) {
      this.telemetry?.record({ evaluatorType, status: "error", durationMs: duration });
      throw new EvaluatorExecutionError("Unexpected response: empty results", {
        meta: { evaluatorType },
      });
    }

    this.telemetry?.record({ evaluatorType, status: result.status, durationMs: duration });
    return result;
  }
}
