import { type Prompt, type TemplateVariables, type CompiledPrompt } from "../prompt";
import { shouldCaptureInput, shouldCaptureOutput } from "@/observability-sdk";
import type { LangWatchSpan } from "@/observability-sdk";

/**
 * Class that decorates the target prompt,
 * adding tracing to specific methods.
 */
export class PromptTracingDecorator {
  constructor(private readonly target: Prompt) {}

  compile(span: LangWatchSpan, variables: TemplateVariables = {}): CompiledPrompt {
    span.setType("prompt");

    if (shouldCaptureInput({ spanType: "prompt" })) {
      span.setInput(this.target.raw);

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

    const result = this.target.compile(variables);

    span.setAttributes({
      'langwatch.prompt.id': result.id,
      'langwatch.prompt.version.id': result.versionId,
      'langwatch.prompt.version.number': result.version,
    });

    if (shouldCaptureOutput({ spanType: "prompt" })) {
      span.setOutput(result.raw);
    }

    return result;
  }

  compileStrict(span: LangWatchSpan, variables: TemplateVariables): CompiledPrompt {
    const result = this.target.compileStrict(variables);

    span.setType("prompt");

    if (shouldCaptureInput({ spanType: "prompt" })) {
      span.setInput(this.target.raw);

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

    span.setAttributes({
      'langwatch.prompt.id': result.id,
      'langwatch.prompt.version.id': result.versionId,
      'langwatch.prompt.version.number': result.version,
    });

    if (shouldCaptureOutput({ spanType: "prompt" })) {
      span.setOutput(result.raw);
    }

    return result;
  }
}
