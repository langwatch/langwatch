import { tracer } from "./tracer";
import * as intSemconv from "../../observability/semconv";
import {
  canAutomaticallyCaptureInput,
  canAutomaticallyCaptureOutput,
} from "../../client";
import { Prompt } from "../prompt";

export function traceCompile(fn: Prompt["compile"]) {
  return (...params: Parameters<Prompt["compile"]>) => {
    const [variables] = params;
    return tracer.withActiveSpan("compile prompt", (span) => {
      span.setType("prompt");

      try {
        const compiledPrompt = fn(variables);

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

        if (variables) {
          if (canAutomaticallyCaptureInput()) {
            span.setAttribute(
              intSemconv.ATTR_LANGWATCH_PROMPT_VARIABLES,
              JSON.stringify({
                type: "json",
                value: variables,
              }),
            );
          }

          return compiledPrompt;
        }

        return compiledPrompt;
      } catch (error) {
        span.recordException(error as Error);
        throw error;
      }
    });
  };
}
