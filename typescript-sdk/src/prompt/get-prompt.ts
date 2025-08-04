import { PromptService } from "./service";
import { CompiledPrompt, Prompt, TemplateVariables } from "./prompt";
import * as intSemconv from "../observability/semconv";
import { tracer } from "./tracer";
import { canAutomaticallyCaptureInput, canAutomaticallyCaptureOutput } from "../client";

export async function getPrompt(id: string, variables: TemplateVariables): Promise<CompiledPrompt>;
export async function getPrompt(id: string): Promise<Prompt>;

export async function getPrompt(id: string, variables?: TemplateVariables): Promise<Prompt | CompiledPrompt> {
  return tracer.withActiveSpan("retrieve prompt", async (span) => {
    span.setType("prompt");
    span.setAttribute(intSemconv.ATTR_LANGWATCH_PROMPT_ID, id);

    const service = PromptService.getInstance();
    const prompt = await service.get(id);

    if (!prompt) {
      throw new Error(`Prompt with ID "${id}" not found`);
    }

    if (canAutomaticallyCaptureOutput()) {
      span.setOutput(prompt);
    }

    span.setAttributes({
      [intSemconv.ATTR_LANGWATCH_PROMPT_ID]: id,
      [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_ID]: prompt.versionId,
      [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER]: prompt.version,
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

      return prompt.compile(variables);
    }

    return prompt;
  });
}
