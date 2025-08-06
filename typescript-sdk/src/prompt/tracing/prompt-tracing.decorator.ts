// typescript-sdk/src/prompt/tracing/prompt-tracing-proxy.ts
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

  get compile() {
    return this.traceCompile("compile");
  }

  get compileStrict() {
    return this.traceCompile("compileStrict");
  }

  private traceCompile(spanName: string) {
    return (...args: Parameters<Prompt["compile"]>) => {
      const [variables] = args;
      return tracer.withActiveSpan(spanName, (span) => {
        span.setType("prompt");

        try {
          const compiledPrompt = this.target.compile.apply(this.target, args);

          if (canAutomaticallyCaptureOutput()) {
            span.setOutput(compiledPrompt);
          }

          span.setAttributes({
            [intSemconv.ATTR_LANGWATCH_PROMPT_ID]: compiledPrompt.id,
            [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_ID]:
              compiledPrompt.versionId,
            [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER]:
              compiledPrompt.version,
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

          return compiledPrompt;
        } catch (error) {
          span.recordException(error as Error);
          throw error;
        }
      });
    };
  }
}
