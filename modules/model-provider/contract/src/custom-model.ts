import type { Named } from "@langwatch/module";
import { z } from "zod";

import { modelSchema } from "./model-provider.ts";

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

const customModelEntrySchemaDefinition = z
  .object({
    modelId: z.string().min(1),
    displayName: z.string().min(1),
    mode: z.enum(["chat", "embedding"]),
    maxTokens: z.number().positive().nullable().optional(),
    supportedParameters: z.array(z.enum(supportedParameterValues)).optional(),
    multimodalInputs: z.array(z.enum(multimodalInputValues)).optional(),
  })
  .strict();
export interface CustomModelEntrySchema extends Named<typeof customModelEntrySchemaDefinition> {}
export const customModelEntrySchema: CustomModelEntrySchema = customModelEntrySchemaDefinition;
export type CustomModelEntry = z.infer<typeof customModelEntrySchema>;

const customModelUpdateInputSchemaDefinition = z.union([
  z.array(customModelEntrySchema),
  z.array(z.string()),
]);
export interface CustomModelUpdateInputSchema extends Named<
  typeof customModelUpdateInputSchemaDefinition
> {}
export const customModelUpdateInputSchema: CustomModelUpdateInputSchema =
  customModelUpdateInputSchemaDefinition;
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
  const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
  const name = record.modelId ?? record.id;
  return typeof name === "string" && name.length > 0 ? name : "<unnamed>";
}

type StoredCustomModelRead = { kind: "read"; entry: CustomModelEntry } | { kind: "rejected" };

/**
 * One stored entry in any shape the column holds: a bare id, the older `modelId` shape, or the
 * `id`/`label`/`type` shape a save writes today. The list it came from decides the mode.
 */
function readStoredCustomModel(entry: unknown, mode: "chat" | "embedding"): StoredCustomModelRead {
  if (typeof entry === "string") {
    return entry.length > 0
      ? { kind: "read", entry: { modelId: entry, displayName: entry, mode } }
      : { kind: "rejected" };
  }
  const legacy = customModelEntrySchema.safeParse(entry);
  if (legacy.success) return { kind: "read", entry: legacy.data };
  const saved = modelSchema.safeParse(entry);
  if (!saved.success) return { kind: "rejected" };
  const { id, label, maxTokens, supportedParameters, multimodalInputs } = saved.data;
  const mapped = customModelEntrySchema.safeParse({
    modelId: id,
    displayName: label,
    mode,
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(supportedParameters === undefined ? {} : { supportedParameters }),
    ...(multimodalInputs === undefined ? {} : { multimodalInputs }),
  });
  return mapped.success ? { kind: "read", entry: mapped.data } : { kind: "rejected" };
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
    const read = readStoredCustomModel(entry, mode);
    if (read.kind === "read") entries.push(read.entry);
    else rejected.push({ name: nameOfRejectedEntry(entry) });
  }
  return { entries, rejected };
}
