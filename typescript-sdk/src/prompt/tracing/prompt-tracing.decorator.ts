import { tracer } from "./tracer";
import * as intSemconv from "../../observability/semconv";
import {
  canAutomaticallyCaptureInput,
  canAutomaticallyCaptureOutput,
} from "../../client";
import { Prompt } from "../prompt";

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

        try {
          const result = fn.apply(this.target, variables);

          if (canAutomaticallyCaptureOutput()) {
            span.setOutput(result);
          }

          span.setAttributes({
            [intSemconv.ATTR_LANGWATCH_PROMPT_ID]: result.id,
            [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_ID]: result.versionId,
            [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER]: result.version,
          });

          if (variables && canAutomaticallyCaptureInput()) {
            span.setAttribute(
              intSemconv.ATTR_LANGWATCH_PROMPT_VARIABLES,
              JSON.stringify({
                type: "json",
                value: variables,
              }),
            );
          }

          return result;
        } catch (error) {
          span.recordException(error as Error);
          throw error;
        }
      });
    };
  }
}
