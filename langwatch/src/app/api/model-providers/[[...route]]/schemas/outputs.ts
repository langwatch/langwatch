import { z } from "zod";
import { customModelEntrySchema } from "~/server/modelProviders/customModel.schema";

const extraHeaderSchema = z.object({
  key: z.string(),
  value: z.string(),
});

/**
 * Zod schema for a single model provider entry in the API response.
 * Matches the MaybeStoredModelProvider type from the registry.
 */
export const apiResponseModelProviderSchema = z.object({
  id: z.string().optional(),
  provider: z.string(),
  enabled: z.boolean(),
  customKeys: z.record(z.unknown()).nullable(),
  deploymentMapping: z.unknown().nullable(),
  models: z.array(z.string()).nullable().optional(),
  embeddingsModels: z.array(z.string()).nullable().optional(),
  customModels: z.array(customModelEntrySchema).nullable().optional(),
  customEmbeddingsModels: z
    .array(customModelEntrySchema)
    .nullable()
    .optional(),
  disabledByDefault: z.boolean().optional(),
  extraHeaders: z.array(extraHeaderSchema).nullable().optional(),
});

export type ApiResponseModelProvider = z.infer<
  typeof apiResponseModelProviderSchema
>;

/**
 * Zod schema for the full model-providers response.
 * A record mapping provider keys to their configuration.
 */
export const apiResponseModelProvidersSchema = z.record(
  apiResponseModelProviderSchema,
);

export type ApiResponseModelProviders = z.infer<
  typeof apiResponseModelProvidersSchema
>;
