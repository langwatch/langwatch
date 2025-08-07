import { tracer } from "./tracer";
import * as intSemconv from "../../observability/semconv";
import { canAutomaticallyCaptureOutput } from "../../client";
import { PromptService } from "../service";

/**
 * Class that decorates the target prompt service,
 * adding tracing to the get method.
 */
export class PromptServiceTracingDecorator {
  constructor(private readonly target: PromptService) {}

  async get(...args: Parameters<PromptService["get"]>) {
    return tracer.withActiveSpan("retrieve prompt", async (span) => {
      span.setType("prompt");
      span.setAttribute(intSemconv.ATTR_LANGWATCH_PROMPT_ID, args[0]);

      try {
        const result = await this.target.get.apply(this.target, args);

        if (result) {
          span.setAttributes({
            [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_ID]: result.versionId,
            [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER]: result.version,
          });

          if (canAutomaticallyCaptureOutput()) {
            span.setOutput(result);
          }
        }

        return result;
      } catch (error) {
        span.recordException(error as Error);
        throw error;
      }
    });
  }
}
