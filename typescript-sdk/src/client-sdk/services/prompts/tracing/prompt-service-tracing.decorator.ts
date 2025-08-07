import { tracer } from "./tracer";
import { PromptsService } from "../service";

/**
 * Class that decorates the target prompt service,
 * adding tracing to the get method.
 */
export class PromptServiceTracingDecorator {
  constructor(private readonly target: PromptsService) {}

  async get(...args: Parameters<PromptsService["get"]>) {
    return tracer.withActiveSpan("retrieve prompt", async (span) => {
      span.setType("prompt");
      span.setAttribute('langwatch.prompt.id', args[0]);

      const result = await this.target.get.apply(this.target, args);

      if (result) {
        span.setAttributes({
          'langwatch.prompt.version.id': result.versionId,
          'langwatch.prompt.version.number': result.version,
        });
      }

      return result;
    });
  }
}
