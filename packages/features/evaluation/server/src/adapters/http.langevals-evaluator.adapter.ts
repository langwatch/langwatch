import { createLogger } from "@langwatch/observability";
import {
  batchEvaluationResultSchema,
  type BatchEvaluationResult,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import {
  EvaluatorExecutionError,
  EvaluatorInputTooLargeError,
} from "@langwatch/evaluation-contract";
import { tryAndConvertTo } from "@langwatch/trace-contract";
import {
  EvaluationLangevalsPort,
  type EvaluationExecutionTelemetryPort,
  type LangevalsEvaluateParams,
} from "../ports/evaluation-execution.port";

const logger = createLogger("langwatch:langevals-http-client");

/**
 * What the transport needs from the deployment: where the evaluator service
 * lives, how long a call may take and how many times a 5xx is retried.
 */
export type LangevalsRuntimeConfig = Readonly<{
  endpoint: string | undefined;
  maxRetries: number;
  timeoutMs: number;
}>;

/** Null object used by self-hosted deployments without a Langevals endpoint. */
export class NullLangevalsEvaluatorClient extends EvaluationLangevalsPort {
  async evaluate(): Promise<SingleEvaluationResult> {
    return { status: "skipped", details: "Langevals client not available" };
  }
}

/**
 * Process-owned HTTP evaluator transport. It owns no durable connection or
 * socket: each request uses the platform fetch implementation and its abort
 * controller is released before the request settles.
 */
export class HttpLangevalsEvaluatorAdapter extends EvaluationLangevalsPort {
  static create(input: {
    config: LangevalsRuntimeConfig;
    telemetry?: EvaluationExecutionTelemetryPort;
  }): HttpLangevalsEvaluatorAdapter | NullLangevalsEvaluatorClient {
    if (!input.config.endpoint) {
      return new NullLangevalsEvaluatorClient();
    }

    return new HttpLangevalsEvaluatorAdapter(input.config, input.telemetry);
  }

  private constructor(
    private readonly config: LangevalsRuntimeConfig,
    private readonly telemetry: EvaluationExecutionTelemetryPort | undefined,
  ) {
    super();
  }

  async evaluate(params: LangevalsEvaluateParams): Promise<SingleEvaluationResult> {
    return await this.evaluateWithRetry(params, this.config.maxRetries);
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
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          data: [
            {
              input: tryAndConvertTo(data.input, "string"),
              output: tryAndConvertTo(data.output, "string"),
              contexts: tryAndConvertTo(data.contexts, "string[]"),
              expected_contexts: tryAndConvertTo(data.expected_contexts, "string[]"),
              expected_output: tryAndConvertTo(data.expected_output, "string"),
              conversation: tryAndConvertTo(data.conversation, "array"),
            },
          ],
          settings: settings ?? {},
          env,
        }),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        logger.warn({ url, timeoutMs: this.config.timeoutMs }, "Evaluator request timed out");
        throw new EvaluatorExecutionError(`Evaluator timed out after ${this.config.timeoutMs}ms`, {
          meta: { evaluatorType, url, timeoutMs: this.config.timeoutMs },
        });
      }

      if (error instanceof Error && error.message.includes("fetch failed")) {
        logger.warn({ error, url }, "Evaluator cannot be reached");
        throw new EvaluatorExecutionError("Evaluator cannot be reached", {
          meta: { evaluatorType, url },
        });
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      if (response.status >= 500 && retriesLeft > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return await this.evaluateWithRetry(params, retriesLeft - 1);
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
