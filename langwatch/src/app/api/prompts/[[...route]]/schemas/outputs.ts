import { PromptScope } from "@prisma/client";
import { z } from "zod";

import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

const configDataSchema = getLatestConfigVersionSchema().shape.configData;

/**
 * Base schema for API Response (only llm config)
 */
const apiResponsePromptSchemaBase = z.object({
  id: z.string(),
  handle: z.string().nullable(),
  scope: z.nativeEnum(PromptScope),
  name: z.string(),
  updatedAt: z.date(),
  projectId: z.string(),
  organizationId: z.string(),
});

/**
 * Schema for version output responses
 * Derives configData fields from storage schema to prevent drift
 */
const apiResponseVersionOutputSchema = z.object({
  configId: z.string(),
  projectId: z.string(),
  versionId: z.string(),
  authorId: z.string().nullable().optional(),
  version: z.number(),
  createdAt: z.date(),
  commitMessage: z.string().optional().nullable(),
  // Derived from storage schema
  prompt: configDataSchema.shape.prompt,
  messages: configDataSchema.shape.messages,
  inputs: configDataSchema.shape.inputs,
  outputs: configDataSchema.shape.outputs,
  model: configDataSchema.shape.model,
  temperature: configDataSchema.shape.temperature,
  maxTokens: configDataSchema.shape.max_tokens,
  demonstrations: configDataSchema.shape.demonstrations,
  promptingTechnique: configDataSchema.shape.prompting_technique,
  responseFormat: configDataSchema.shape.response_format,
});

/**
 * Expected shape for a returned prompt from the API
 *
 * Includes llm config + version data
 */
export const apiResponsePromptWithVersionDataSchema =
  apiResponsePromptSchemaBase.merge(
    apiResponseVersionOutputSchema.omit({
      configId: true,
    })
  );

export type ApiResponsePrompt = z.infer<
  typeof apiResponsePromptWithVersionDataSchema
>;
