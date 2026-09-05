/**
 * The registry's context-window and output ceilings for one model id.
 */
import { getModelById, type ModelLimits } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:model-provider:model-limits");

/** The id as given, then the part after the last `/`. */
function modelNameVariations(modelName: string): string[] {
  const variations = [modelName];
  const baseName = modelName.split("/").pop() ?? modelName;
  if (baseName !== modelName) {
    variations.push(baseName);
  }

  return variations;
}

export class ModelLimitsService {
  static create(): ModelLimitsService {
    return new ModelLimitsService();
  }

  private constructor() {}

  /** The ceilings for a model id, or null when the catalogue does not name it. */
  getModelLimits(modelName: string): ModelLimits | null {
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
}
