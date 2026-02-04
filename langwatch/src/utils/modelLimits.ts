import { getModelById } from "../server/modelProviders/registry";
import { createLogger } from "./logger";

const logger = createLogger("modelLimits");

/**
 * Model token limits for context window and output generation.
 *
 * Semantic differences:
 * - maxInputTokens: Maximum tokens in input context (prompt + conversation history)
 * - maxOutputTokens: Maximum tokens the model can generate in response
 * - maxTokens: General context length reference (same as maxInputTokens for most models)
 *
 * Note: Currently maxInputTokens and maxTokens are both set from contextLength.
 * maxInputTokens is retained for semantic clarity in contexts that specifically
 * need to reference input limits vs output limits.
 */
export interface ModelLimits {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTokens?: number;
}

/**
 * Generate possible model name variations to try
 * This covers common provider prefixes and naming patterns
 * NOTE: This is not exhaustive and may not cover all possible variations
 */
function generateModelNameVariations(modelName: string): string[] {
  const variations: string[] = [];

  // Add the original full name first
  variations.push(modelName);

  // Extract base name (everything after the last /)
  const baseName = modelName.split("/").pop() ?? modelName;
  if (baseName !== modelName) {
    variations.push(baseName);
  }

  return variations;
}

/**
 * Get model limits from the model registry
 * Tries multiple name variations to find the model data
 *
 * @param modelName - The model name to get limits for (e.g., "openai/gpt-5")
 * @returns Model limits or null if not found
 */
export function getModelLimits(modelName: string): ModelLimits | null {
  try {
    // Try different variations of the model name
    const variations = generateModelNameVariations(modelName);

    for (const variation of variations) {
      const model = getModelById(variation);

      if (model) {
        return {
          maxInputTokens: model.contextLength,
          maxOutputTokens: model.maxCompletionTokens ?? undefined,
          maxTokens: model.contextLength,
        };
      }
    }

    // Model not found in any variation
    return null;
  } catch (error) {
    logger.error({ modelName, error }, "error getting model limits");
    // Return null for any parsing errors (safer than throwing)
    return null;
  }
}
