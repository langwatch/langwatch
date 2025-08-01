import { PromptService } from "./service";
import { CompiledPrompt, Prompt, TemplateVariables } from "./prompt";
import * as intSemconv from "../observability/semconv";
import { tracer } from "./tracer";
import { canAutomaticallyCaptureInput, canAutomaticallyCaptureOutput } from "../client";

export async function getPromptVersion(id: string, versionId: string, variables: TemplateVariables): Promise<CompiledPrompt>;
export async function getPromptVersion(id: string, versionId: string): Promise<Prompt>;

export async function getPromptVersion(id: string, versionId: string, variables?: TemplateVariables): Promise<Prompt | CompiledPrompt> {
  return tracer.withActiveSpan("retrieve prompt", async (span) => {
    span.setType("prompt");
    span.setAttribute(intSemconv.ATTR_LANGWATCH_PROMPT_ID, id);

    const service = PromptService.getInstance();
    const prompt = await service.getVersions(id);
    const promptVersion = prompt[versionId];

    if (!promptVersion) {
      throw new Error(`Prompt version ${versionId} not found for prompt ${id}`);
    }

    if (canAutomaticallyCaptureOutput()) {
      span.setOutput(prompt);
    }

    span.setAttributes({
      [intSemconv.ATTR_LANGWATCH_PROMPT_ID]: id,
      [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_ID]: promptVersion.id,
      [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER]: promptVersion.version,
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

      return promptVersion.compile(variables);
    }

    return promptVersion;
  });
}
