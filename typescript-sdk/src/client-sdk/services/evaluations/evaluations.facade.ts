/**
 * EvaluationsFacade - Entry point for the Evaluations API (Online Evaluations / Guardrails)
 *
 * Provides an API for running evaluators and guardrails in real-time against LLM inputs/outputs.
 *
 * @example
 * ```typescript
 * const langwatch = new LangWatch({ apiKey: "your-api-key" });
 *
 * // Run a guardrail
 * const guardrail = await langwatch.evaluations.evaluate("presidio/pii_detection", {
 *   data: { input: userInput, output: generatedResponse },
 *   name: "PII Detection",
 *   asGuardrail: true,
 *   settings: {},
 * });
 *
 * if (!guardrail.passed) {
 *   return "I'm sorry, I can't do that.";
 * }
 * ```
 */

import { trace, SpanStatusCode, context as otelContext } from "@opentelemetry/api";
import { createLangWatchSpan } from "@/observability-sdk/span/implementation";
import type {
  EvaluationResult,
  EvaluateOptions,
  EvaluateRequest,
  EvaluateResponse,
} from "./types";
import {
  EvaluatorCallError,
  EvaluatorNotFoundError,
  EvaluationsApiError,
} from "./errors";
import type { Logger } from "@/logger";

type EvaluationsFacadeConfig = {
  endpoint: string;
  apiKey: string;
  logger: Logger;
};

export class EvaluationsFacade {
  readonly #endpoint: string;
  readonly #apiKey: string;
  readonly #logger: Logger;

  constructor(config: EvaluationsFacadeConfig) {
    this.#endpoint = config.endpoint;
    this.#apiKey = config.apiKey;
    this.#logger = config.logger;
  }

  /**
   * Run an evaluator or guardrail against provided data
   *
   * Creates an OpenTelemetry span attached to the current trace context,
   * calls the LangWatch evaluation API, and returns the result.
   *
   * @param slug - The evaluator slug (e.g., "presidio/pii_detection", "langevals/llm_boolean")
   * @param options - Evaluation options including data, name, settings, and asGuardrail flag
   * @returns The evaluation result with status, passed, score, details, label, and cost
   *
   * @example
   * ```typescript
   * // Run as a guardrail (synchronous evaluation that can block responses)
   * const guardrail = await langwatch.evaluations.evaluate("presidio/pii_detection", {
   *   data: { input: userInput, output: generatedResponse },
   *   name: "PII Detection Guardrail",
   *   asGuardrail: true,
   * });
   *
   * if (!guardrail.passed) {
   *   console.log("PII detected:", guardrail.details);
   *   return "Sorry, I cannot process that request.";
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Run as an online evaluation (async scoring for monitoring)
   * const result = await langwatch.evaluations.evaluate("langevals/llm_boolean", {
   *   data: { input: question, output: response },
   *   name: "Quality Check",
   *   settings: { prompt: "Check if the response answers the question." },
   * });
   *
   * console.log("Score:", result.score);
   * console.log("Details:", result.details);
   * ```
   */
  evaluate = async (
    slug: string,
    options: EvaluateOptions
  ): Promise<EvaluationResult> => {
    const { data, name, settings, asGuardrail } = options;
    const spanName = name ?? slug;
    const spanType = asGuardrail ? "guardrail" : "evaluation";

    // Get tracer and create a span attached to the current context
    const tracer = trace.getTracer("langwatch-evaluations");

    // Get current trace/span IDs from active context
    const activeSpan = trace.getActiveSpan();
    const traceId = activeSpan
      ? activeSpan.spanContext().traceId
      : undefined;
    const parentSpanId = activeSpan
      ? activeSpan.spanContext().spanId
      : undefined;

    // Start the evaluation span
    const otelSpan = tracer.startSpan(
      spanName,
      {
        attributes: {
          "langwatch.span.type": spanType,
        },
      },
      otelContext.active()
    );

    const langwatchSpan = createLangWatchSpan(otelSpan);

    // Set span input
    langwatchSpan.setType(spanType);
    langwatchSpan.setInput({
      data,
      ...(settings && { settings }),
    });

    try {
      // Build request payload
      const requestBody: EvaluateRequest = {
        trace_id: traceId ?? null,
        span_id: parentSpanId ?? null,
        name: name ?? null,
        data,
        settings,
        as_guardrail: asGuardrail,
      };

      // Call the evaluation API
      const url = `${this.#endpoint}/api/evaluations/${slug}/evaluate`;

      this.#logger.debug(`Calling evaluation API: ${url}`);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": this.#apiKey,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();

        if (response.status === 404) {
          throw new EvaluatorNotFoundError(slug);
        }

        throw new EvaluationsApiError(
          `Evaluation API returned ${response.status}: ${errorText}`,
          response.status
        );
      }

      const responseData = (await response.json()) as EvaluateResponse;

      // Map response to result
      const result: EvaluationResult = {
        status: responseData.status,
        ...(responseData.passed !== null && responseData.passed !== undefined && { passed: responseData.passed }),
        ...(responseData.score !== null && responseData.score !== undefined && { score: responseData.score }),
        ...(responseData.details !== null && responseData.details !== undefined && { details: responseData.details }),
        ...(responseData.label !== null && responseData.label !== undefined && { label: responseData.label }),
        ...(responseData.cost !== null && responseData.cost !== undefined && { cost: responseData.cost }),
      };

      // Update span with output
      langwatchSpan.setOutput({
        type: asGuardrail ? "guardrail_result" : "evaluation_result",
        value: result,
      });

      // Set span status based on result
      if (result.status === "error") {
        otelSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: result.details ?? "Evaluation failed",
        });
      } else {
        otelSpan.setStatus({ code: SpanStatusCode.OK });
      }

      return result;
    } catch (error) {
      // Handle errors
      const errorResult: EvaluationResult = {
        status: "error",
        details: error instanceof Error ? error.message : String(error),
      };

      // For guardrails, default to passed=true on error to avoid blocking
      if (asGuardrail) {
        errorResult.passed = true;
      }

      // Update span with error
      langwatchSpan.setOutput({
        type: asGuardrail ? "guardrail_result" : "evaluation_result",
        value: errorResult,
      });

      otelSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: errorResult.details,
      });

      if (error instanceof Error) {
        otelSpan.recordException(error);
      }

      // Re-throw known errors
      if (
        error instanceof EvaluatorNotFoundError ||
        error instanceof EvaluationsApiError ||
        error instanceof EvaluatorCallError
      ) {
        throw error;
      }

      // Wrap unknown errors
      throw new EvaluatorCallError(
        slug,
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      // Always end the span
      otelSpan.end();
    }
  };
}
