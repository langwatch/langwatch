import { tracer } from "./tracer";
import * as intSemconv from "../../observability/semconv";
import { canAutomaticallyCaptureOutput } from "../../client";
import { PromptService } from "../service";

export function traceGetPrompt(fn: PromptService["get"]) {
  return async (...params: Parameters<PromptService["get"]>) => {
    return tracer.withActiveSpan("retrieve prompt", async (span) => {
      span.setType("prompt");
      span.setAttribute(intSemconv.ATTR_LANGWATCH_PROMPT_ID, params[0]);

      try {
        const prompt = await fn(...params);

        if (prompt) {
          span.setAttributes({
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
  };
}
