import { z } from "zod";

/** Parameters exposed by the custom-model configuration UI. */
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

export const multimodalInputValues = ["image", "file", "audio"] as const;
export type MultimodalInput = (typeof multimodalInputValues)[number];

export const customModelEntrySchema = z
  .object({
    modelId: z.string().min(1),
    displayName: z.string().min(1),
    mode: z.enum(["chat", "embedding"]),
    maxTokens: z.number().positive().nullable().optional(),
    supportedParameters: z.array(z.enum(supportedParameterValues)).optional(),
    multimodalInputs: z.array(z.enum(multimodalInputValues)).optional(),
  })
  .strict();
export type CustomModelEntry = z.infer<typeof customModelEntrySchema>;

export const customModelUpdateInputSchema = z.union([
  z.array(customModelEntrySchema),
  z.array(z.string()),
]);
export type CustomModelsInput = z.infer<typeof customModelUpdateInputSchema>;

export function isLegacyCustomModels(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  return typeof value[0] === "string";
}

export function toLegacyCompatibleCustomModels(
  value: unknown,
  mode: "chat" | "embedding",
): CustomModelEntry[] {
  if (value == null || !Array.isArray(value)) return [];
  if (isLegacyCustomModels(value)) {
    return value.map((modelId) => ({ modelId, displayName: modelId, mode }));
  }
  return value.flatMap((entry) => {
    const parsed = customModelEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}
