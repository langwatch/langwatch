import { tracer } from "./tracer";
import { Prompt } from "../prompt";
import { shouldCaptureInput } from "@/observability-sdk";

/**
 * Class that decorates the target prompt,
 * adding tracing to specific methods.
 */
export class PromptTracingDecorator {
  constructor(private readonly target: Prompt) {}

  compile(...variables: Parameters<Prompt["compile"]>) {
    return this.wrapCompileFn("compile", this.target.compile)(...variables);
  }

  compileStrict(...variables: Parameters<Prompt["compileStrict"]>) {
    return this.wrapCompileFn(
      "compileStrict",
      this.target.compileStrict,
    )(...variables);
  }

  private wrapCompileFn<T extends (...args: any[]) => any>(
    spanName: string,
    fn: (...args: Parameters<T>) => ReturnType<T>,
  ) {
    return (...variables: Parameters<T>) => {
      return tracer.withActiveSpan(spanName, (span) => {
        span.setType("prompt");

        const result = fn.apply(this.target, variables);

        if (shouldCaptureInput()) {
          span.setInput(result);
        }

        span.setAttributes({
          'langwatch.prompt.id': result.id,
          'langwatch.prompt.version.id': result.versionId,
          'langwatch.prompt.version.number': result.version,
        });

        if (variables && shouldCaptureInput()) {
          span.setAttribute(
            'langwatch.prompt.variables',
            JSON.stringify({
              type: "json",
              value: variables,
            }),
          );
        }

        return result;
      });
    };
  }
}
