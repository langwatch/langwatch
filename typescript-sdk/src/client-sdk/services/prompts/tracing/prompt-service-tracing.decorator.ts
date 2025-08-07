import { tracer } from "./tracer";
import * as intSemconv from "@/observability-sdk/semconv";
import { PromptsService } from "../service";
import { shouldCaptureOutput } from "@/observability-sdk";

/**
 * Class that decorates the target prompt service,
 * adding tracing to the get method.
 */
export class PromptServiceTracingDecorator {
  constructor(private readonly target: PromptsService) {}

  async get(...args: Parameters<PromptsService["get"]>) {
    return tracer.withActiveSpan("retrieve prompt", async (span) => {
      span.setType("prompt");
      span.setAttribute(intSemconv.ATTR_LANGWATCH_PROMPT_ID, args[0]);

      const result = await this.target.get.apply(this.target, args);

      if (result) {
        span.setAttributes({
          [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_ID]: result.versionId,
          [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER]: result.version,
        });

        if (shouldCaptureOutput()) {
          span.setOutput(result);
        }
      }

      return result;
    });
  }
}
