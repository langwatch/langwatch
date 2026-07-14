import { z } from "zod";
import {
  customModelEntrySchema,
} from "~/server/modelProviders/customModel.schema";

export const updateModelProviderInputSchema = z.object({
  enabled: z.boolean(),
  customKeys: z.record(z.unknown()).optional(),
  customModels: z
    .union([z.array(customModelEntrySchema), z.array(z.string())])
    .optional(),
  customEmbeddingsModels: z
    .union([z.array(customModelEntrySchema), z.array(z.string())])
    .optional(),
  extraHeaders: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .optional(),
  defaultModel: z.string().optional(),
});
