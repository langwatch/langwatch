/**
 * The registry's context-window and output ceilings for one model id.
 */
import { findModelById, type ModelLimits } from "@langwatch/model-provider-contract";

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
  pickModelLimits(modelName: string): ModelLimits | null {
    for (const variation of modelNameVariations(modelName)) {
      const model = findModelById(variation)[0];
      if (model) {
        return {
          maxInputTokens: model.contextLength,
          maxOutputTokens: model.maxCompletionTokens ?? undefined,
          maxTokens: model.contextLength,
        };
      }
    }

    return null;
  }
}
