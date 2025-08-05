import {
  type Prompt,
  type CompiledPrompt,
  type TemplateVariables,
} from "./prompt";
import { tracer } from "./tracer";
import * as intSemconv from "../observability/semconv";
import {
  canAutomaticallyCaptureInput,
  canAutomaticallyCaptureOutput,
} from "../client";

/**
 * Tracing decorator for Prompt that adds observability to compilation operations.
 *
 * Wraps the compile method with tracing spans to provide visibility into:
 * - Template variable substitution
 * - Compilation performance metrics
 * - Input/output capture when enabled
 *
 * Follows the decorator pattern to maintain separation of concerns between
 * business logic and observability concerns.
 */
export class PromptTracingDecorator {
  constructor(private readonly prompt: Prompt) {}

  /**
   * Traces prompt compilation operations.
   * Creates a span with compilation metadata and captures variables/output when enabled.
   */
  compile(variables: TemplateVariables) {
    return tracer.withActiveSpan("compile prompt", (span) => {
      span.setType("prompt");
      span.setAttributes({
        [intSemconv.ATTR_LANGWATCH_PROMPT_ID]: this.prompt.id,
        [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_ID]: this.prompt.versionId,
        [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER]: this.prompt.version,
      });

      if (canAutomaticallyCaptureInput()) {
        span.setAttribute(
          intSemconv.ATTR_LANGWATCH_PROMPT_VARIABLES,
          JSON.stringify({
            type: "json",
            value: variables,
          }),
        );
      }

      try {
        const compiledPrompt = this.prompt.compile(variables);

        if (canAutomaticallyCaptureOutput()) {
          span.setOutput(compiledPrompt);
        }

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        return compiledPrompt as CompiledPrompt;
      } catch (error) {
        span.recordException(error as Error);
        throw error;
      }
    });
  }

  compileStrict(variables: TemplateVariables) {
    return tracer.withActiveSpan("compile prompt", (span) => {
      span.setType("prompt");
      span.setAttributes({
        [intSemconv.ATTR_LANGWATCH_PROMPT_ID]: this.prompt.id,
        [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_ID]: this.prompt.versionId,
        [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER]: this.prompt.version,
      });

      if (canAutomaticallyCaptureInput()) {
        span.setAttribute(
          intSemconv.ATTR_LANGWATCH_PROMPT_VARIABLES,
          JSON.stringify({
            type: "json",
            value: variables,
          }),
        );
      }

      try {
        const compiledPrompt = this.prompt.compileStrict(variables);

        if (canAutomaticallyCaptureOutput()) {
          span.setOutput(compiledPrompt);
        }

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        return compiledPrompt as CompiledPrompt;
      } catch (error) {
        span.recordException(error as Error);
        throw error;
      }
    });
  }
}
