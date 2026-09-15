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

/** A stored entry that failed the strict parse, named without its content. */
export type RejectedCustomModelEntry = { name: string };

export type ParsedCustomModels = {
  entries: CustomModelEntry[];
  rejected: RejectedCustomModelEntry[];
};

/** Best-effort name for a log line — never the raw (possibly huge) entry. */
function nameOfRejectedEntry(entry: unknown): string {
  const modelId =
    entry && typeof entry === "object" ? (entry as Record<string, unknown>).modelId : void 0;
  return typeof modelId === "string" && modelId.length > 0 ? modelId : "<unnamed>";
}

export function toLegacyCompatibleCustomModels(
  value: unknown,
  mode: "chat" | "embedding",
): ParsedCustomModels {
  if (value == null || !Array.isArray(value)) return { entries: [], rejected: [] };
  if (isLegacyCustomModels(value)) {
    return {
      entries: value.map((modelId) => ({ modelId, displayName: modelId, mode })),
      rejected: [],
    };
  }
  const entries: CustomModelEntry[] = [];
  const rejected: RejectedCustomModelEntry[] = [];
  for (const entry of value) {
    const parsed = customModelEntrySchema.safeParse(entry);
    if (parsed.success) entries.push(parsed.data);
    else rejected.push({ name: nameOfRejectedEntry(entry) });
  }
  return { entries, rejected };
}
