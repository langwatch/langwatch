import { tracer } from "./tracer";
import * as intSemconv from "@/observability-sdk/semconv";
import { Prompt } from "../prompt";
import { InternalConfig } from "@/client-sdk/types";

/**
 * Class that decorates the target prompt,
 * adding tracing to specific methods.
 */
export class PromptTracingDecorator {
  constructor(private readonly target: Prompt, private readonly config: InternalConfig) {}

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

        if (this.config.observability?.dataCapture.mode === "output") {
          span.setOutput(result);
        }

        span.setAttributes({
          [intSemconv.ATTR_LANGWATCH_PROMPT_ID]: result.id,
          [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_ID]: result.versionId,
          [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER]: result.version,
        });

        if (variables && this.config.observability?.dataCapture?.input) {
          span.setAttribute(
            intSemconv.ATTR_LANGWATCH_PROMPT_VARIABLES,
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
