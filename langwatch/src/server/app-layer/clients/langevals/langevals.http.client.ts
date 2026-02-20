import { EvaluatorExecutionError } from "../../evaluations/errors";
import type { BatchEvaluationResult, SingleEvaluationResult } from "~/server/evaluations/evaluators.generated";
import { evaluationDurationHistogram, getEvaluationStatusCounter } from "~/server/metrics";
import { tryAndConvertTo } from "~/server/tracer/tracesMapping";
import { createLogger } from "~/utils/logger/server";
import type { LangEvalsClient, LangEvalsEvaluateParams } from "./langevals.client";

const logger = createLogger("langwatch:langevals-http-client");

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

export class LangEvalsHttpClient implements LangEvalsClient {
  constructor(
    private readonly endpoint: string,
    private readonly maxRetries: number = 1,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async evaluate(params: LangEvalsEvaluateParams): Promise<SingleEvaluationResult> {
    return this.evaluateWithRetry(params, this.maxRetries);
  }

  private async evaluateWithRetry(
    params: LangEvalsEvaluateParams,
    retriesLeft: number,
  ): Promise<SingleEvaluationResult> {
    const { evaluatorType, data, settings, env } = params;
    const url = `${this.endpoint}/${evaluatorType}/evaluate`;

    const startTime = performance.now();
    let response: Response;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        logger.error({ url, timeoutMs: this.timeoutMs }, "Evaluator request timed out");
        throw new EvaluatorExecutionError(
          `Evaluator timed out after ${this.timeoutMs}ms`,
          { meta: { evaluatorType, url, timeoutMs: this.timeoutMs } },
        );
      }
      if (error instanceof Error && error.message.includes("fetch failed")) {
        logger.error({ error, url }, "Evaluator cannot be reached");
        throw new EvaluatorExecutionError("Evaluator cannot be reached", {
          meta: { evaluatorType, url },
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const duration = performance.now() - startTime;
    evaluationDurationHistogram.labels(evaluatorType).observe(duration);

    if (!response.ok) {
      if (response.status >= 500 && retriesLeft > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return this.evaluateWithRetry(params, retriesLeft - 1);
      }

      getEvaluationStatusCounter(evaluatorType, "error").inc();
      let statusText = response.statusText;
      try {
        statusText = JSON.stringify(await response.json(), undefined, 2);
      } catch {
        /* safe json parse fallback */
      }
      throw new EvaluatorExecutionError(
        `${response.status} ${statusText}`,
        { meta: { evaluatorType, httpStatus: response.status } },
      );
    }

    const result = ((await response.json()) as BatchEvaluationResult)[0];
    if (!result) {
      getEvaluationStatusCounter(evaluatorType, "error").inc();
      throw new EvaluatorExecutionError("Unexpected response: empty results", {
        meta: { evaluatorType },
      });
    }

    getEvaluationStatusCounter(evaluatorType, result.status).inc();
    return result;
  }
}
