import { z } from "zod";

/**
 * Known parameter names from the parameter registry.
 * These are the parameters that can be configured in LLMConfigPopover.
 */
export const supportedParameterValues = [
  "temperature",
  "max_tokens",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "top_k",
  "min_p",
  "repetition_penalty",
  "seed",
  "reasoning",
  "verbosity",
] as const;

export type SupportedParameter = (typeof supportedParameterValues)[number];

/**
 * Multimodal input types a custom model can support.
 */
export const multimodalInputValues = ["image", "file", "audio"] as const;

export type MultimodalInput = (typeof multimodalInputValues)[number];

/**
 * Zod schema for a custom model entry.
 * Represents a user-defined model (fine-tune, self-hosted, etc.)
 * with full metadata for UI display and parameter configuration.
 */
export const customModelEntrySchema = z.object({
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  mode: z.enum(["chat", "embedding"]),
  maxTokens: z.number().positive().nullable().optional(),
  supportedParameters: z.array(z.enum(supportedParameterValues)).optional(),
  multimodalInputs: z.array(z.enum(multimodalInputValues)).optional(),
});

/**
 * A user-defined custom model entry with metadata.
 */
export type CustomModelEntry = z.infer<typeof customModelEntrySchema>;

/**
 * Union schema for the tRPC update mutation input.
 * Accepts both the legacy string[] format (for backward compatibility)
 * and the new CustomModelEntry[] format.
 */
export const customModelUpdateInputSchema = z.union([
  z.array(customModelEntrySchema),
  z.array(z.string()),
]);

/**
 * Inferred type for the union input accepted by service/repository layers.
 * Single source of truth — use this instead of manually writing `CustomModelEntry[] | string[]`.
 */
export type CustomModelsInput = z.infer<typeof customModelUpdateInputSchema>;

/**
 * Type guard that detects old string[] format vs new CustomModelEntry[] format
 * when reading custom models from the database.
 *
 * The DB column is Json?, so it can be either:
 * - string[] (legacy format: just model ID strings)
 * - CustomModelEntry[] (new format: objects with metadata)
 * - null/undefined
 *
 * @returns true if the value is a legacy string array
 */
export function isLegacyCustomModels(
  value: unknown,
): value is string[] {
  if (!Array.isArray(value)) return false;
  // Empty array is considered legacy (no elements to distinguish)
  if (value.length === 0) return true;
  // If the first element is a string, it's legacy format
  return typeof value[0] === "string";
}

/**
 * Converts a raw DB value (which may be legacy string[] or new CustomModelEntry[])
 * into a normalized CustomModelEntry[].
 *
 * @param value - Raw value from the database (string[], CustomModelEntry[], null, or undefined)
 * @param mode - The mode to assign when converting legacy strings ("chat" or "embedding")
 * @returns Normalized array of CustomModelEntry objects
 */
export function toLegacyCompatibleCustomModels(
  value: unknown,
  mode: "chat" | "embedding",
): CustomModelEntry[] {
  if (value == null) return [];
  if (!Array.isArray(value)) return [];

  if (isLegacyCustomModels(value)) {
    return value.map((modelId) => ({
      modelId,
      displayName: modelId,
      mode,
    }));
  }

  // Already in new format
  return value as CustomModelEntry[];
}
