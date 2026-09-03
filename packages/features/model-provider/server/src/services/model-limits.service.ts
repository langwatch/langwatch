/**
 * The registry's context-window and output ceilings for one model id.
 *
 * Read by the model pickers, which cap a max-tokens field at what the model
 * will actually accept. The lookup tries the id as given and then its bare
 * name, because a caller names a model either way (`openai/gpt-5` and `gpt-5`
 * are the same row of the catalogue).
 *
 * Answers `null` rather than throwing on anything it cannot resolve: a picker
 * that cannot find a ceiling shows no ceiling, which is the honest answer for
 * a model the catalogue has never heard of.
 */
import { getModelById, type ModelLimits } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:model-provider:model-limits");

/** The id as given, then the part after the last `/`. */
function modelNameVariations(modelName: string): string[] {
  const variations = [modelName];
  const baseName = modelName.split("/").pop() ?? modelName;
  if (baseName !== modelName) variations.push(baseName);
  return variations;
}

/** The ceilings for a model id, or null when the catalogue does not name it. */
export function getModelLimits(modelName: string): ModelLimits | null {
  try {
    for (const variation of modelNameVariations(modelName)) {
      const model = getModelById(variation);
      if (model) {
        return {
          maxInputTokens: model.contextLength,
          maxOutputTokens: model.maxCompletionTokens ?? undefined,
          maxTokens: model.contextLength,
        };
      }
    }
    return null;
  } catch (error) {
    logger.error({ modelName, error }, "error getting model limits");
    return null;
  }
}
