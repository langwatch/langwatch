import * as llmModelCostsRaw from "../server/modelProviders/llmModelCosts.json";
import { createLogger } from "./logger";

const logger = createLogger("modelLimits");

export interface ModelLimits {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTokens?: number;
}

/**
 * Load model costs data with proper default handling
 * Extracted from llmModelCost.tsx to avoid duplication
 */
function loadModelCostsData() {
  return "default" in llmModelCostsRaw
    ? (llmModelCostsRaw.default as typeof llmModelCostsRaw)
    : llmModelCostsRaw;
}

/**
 * Generate possible model name variations to try
 * This covers common provider prefixes and naming patterns
 * NOTE: This is not exhaustive and may not cover all possible variations
 */
function generateModelNameVariations(modelName: string): string[] {
  const variations: string[] = [];

  // Extract base name (everything after the last /)
  const baseName = modelName.split("/").pop() ?? modelName;
  variations.push(baseName);

  // Add the original full name
  if (modelName !== baseName) {
    variations.push(modelName);
  }

  // Try with openrouter prefix (common in some setups)
  variations.push(`openrouter/${baseName}`);
  if (modelName !== baseName) {
    variations.push(`openrouter/${modelName}`);
  }

  return variations;
}

/**
 * Get model limits from the model costs data
 * Tries multiple name variations to find the model data
 *
 * @param modelName - The model name to get limits for (e.g., "openai/gpt-5")
 * @returns Model limits or null if not found
 */
export function getModelLimits(modelName: string): ModelLimits | null {
  try {
    const llmModelCosts = loadModelCostsData();

    // Try different variations of the model name
    const variations = generateModelNameVariations(modelName);

    for (const variation of variations) {
      const name_ = variation as keyof typeof llmModelCosts;
      const model = llmModelCosts[name_] as {
        max_input_tokens?: number;
        max_output_tokens?: number;
        max_tokens?: number;
      };

      if (model && typeof model === "object") {
        return {
          maxInputTokens: model.max_input_tokens,
          maxOutputTokens: model.max_output_tokens,
          maxTokens: model.max_tokens,
        };
      }
    }

    // Model not found in any variation
    return null;
  } catch (error) {
    logger.error("error getting model limits for", { modelName, error });
    // Return null for any parsing errors (safer than throwing)
    return null;
  }
}
