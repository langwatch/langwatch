import { type PromptService } from "./service";
import { type Prompt } from "./prompt";
import { tracer } from "./tracer";
import * as intSemconv from "../observability/semconv";
import {
  canAutomaticallyCaptureInput,
  canAutomaticallyCaptureOutput,
} from "../client";

/**
 * Tracing decorator for PromptService that adds observability to prompt operations.
 *
 * Wraps key PromptService methods with tracing spans to provide visibility into:
 * - Prompt retrieval operations
 * - Prompt compilation with variables
 * - Performance metrics and error tracking
 *
 * Follows the decorator pattern to maintain separation of concerns between
 * business logic and observability concerns.
 */
export class PromptServiceTracingDecorator {
  constructor(private readonly service: PromptService) {}

  /**
   * Traces prompt retrieval operations.
   * Creates a span with prompt metadata and captures input/output when enabled.
   */
  async get(
    id: string,
    options?: { version?: string },
  ): Promise<Prompt | null> {
    return tracer.withActiveSpan("retrieve prompt", async (span) => {
      span.setType("prompt");
      span.setAttribute(intSemconv.ATTR_LANGWATCH_PROMPT_ID, id);

      if (canAutomaticallyCaptureInput()) {
        span.setAttribute(
          intSemconv.ATTR_LANGWATCH_PROMPT_VARIABLES,
          JSON.stringify({
            type: "json",
            value: { id, options },
          }),
        );
      }

      try {
        const prompt = await this.service.get(id, options);

        if (prompt) {
          span.setAttributes({
            [intSemconv.ATTR_LANGWATCH_PROMPT_ID]: prompt.id,
            [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_ID]: prompt.versionId,
            [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER]: prompt.version,
          });

          if (canAutomaticallyCaptureOutput()) {
            span.setOutput(prompt);
          }
        }

        return prompt;
      } catch (error) {
        span.recordException(error as Error);
        throw error;
      }
    });
  }
}
