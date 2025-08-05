import { PromptService } from "./service";
import {
  type CompiledPrompt,
  type Prompt,
  type TemplateVariables,
} from "./prompt";
import * as intSemconv from "../observability/semconv";
import { tracer } from "./tracing";
import {
  canAutomaticallyCaptureInput,
  canAutomaticallyCaptureOutput,
} from "../client";

/**
 * Retrieves a specific version of a prompt by ID and optionally compiles it with variables.
 * @param id - The ID of the prompt to retrieve.
 * @param versionId - The ID of the version to retrieve.
 * @param variables - Optional variables to compile the prompt with.
 * @returns The prompt or compiled prompt.
 * @deprecated Use the PromptFacade instead: langwatch.prompts.get(id, versionId, variables)
 * @throws {Error} If the prompt version is not found.
 */
export async function getPromptVersion(
  id: string,
  versionId: string,
  variables: TemplateVariables,
): Promise<CompiledPrompt>;
export async function getPromptVersion(
  id: string,
  versionId: string,
): Promise<Prompt>;
export async function getPromptVersion(
  id: string,
  versionId: string,
  variables?: TemplateVariables,
): Promise<Prompt | CompiledPrompt> {
  return tracer.withActiveSpan("retrieve prompt version", async (span) => {
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
