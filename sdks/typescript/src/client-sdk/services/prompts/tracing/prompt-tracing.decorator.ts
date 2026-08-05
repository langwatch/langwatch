import { type Prompt, type TemplateVariables, type CompiledPrompt } from "../prompt";
import { shouldCaptureInput, shouldCaptureOutput } from "@/observability-sdk";
import type { LangWatchSpan } from "@/observability-sdk";

/**
 * Class that decorates the target prompt,
 * adding tracing to specific methods.
 */
export class PromptTracingDecorator {
  constructor(private readonly target: Prompt) {}

  private traceCompilation(
    span: LangWatchSpan,
    variables: TemplateVariables,
    compileFn: () => CompiledPrompt
  ): CompiledPrompt {
    span.setType("prompt");

    if (shouldCaptureInput()) {
      span.setInput(this.target);

      if (variables) {
        span.setAttribute(
          'langwatch.prompt.variables',
          JSON.stringify({
            type: "json",
            value: variables,
          }),
        );
      }
    }

    const result = compileFn();

    // Only emit combined handle:version format when both are available
    if (result.handle != null && result.version != null) {
      span.setAttribute(
        'langwatch.prompt.id',
        `${result.handle}:${result.version}`,
      );
    }

    if (shouldCaptureOutput()) {
      span.setOutput({
        ...result,
        raw: void 0, // TODO(afr): Figure out a better way to do this.
      });
    }

    return result;
  }

  compile(span: LangWatchSpan, variables: TemplateVariables = {}): CompiledPrompt {
    return this.traceCompilation(
      span,
      variables,
      () => this.target.compile(variables),
    );
  }

  compileStrict(span: LangWatchSpan, variables: TemplateVariables): CompiledPrompt {
    return this.traceCompilation(
      span,
      variables,
      () => this.target.compileStrict(variables),
    );
  }
}
