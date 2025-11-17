import { PromptScope } from "@prisma/client";
import { z } from "zod";

import { nodeDatasetSchema } from "~/optimization_studio/types/dsl";
import {
  inputsSchema,
  messageSchema,
  outputsSchema,
  promptingTechniqueSchema,
  responseFormatSchema,
} from "~/prompts/schemas";

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
 * Extends the input schema with metadata about the created version
 */
const apiResponseVersionOutputSchema = z.object({
  configId: z.string(),
  projectId: z.string(),
  versionId: z.string(),
  authorId: z.string().nullable().optional(),
  version: z.number(),
  createdAt: z.date(),
  commitMessage: z.string().optional().nullable(),
  prompt: z.string(),
  messages: z.array(messageSchema).default([]),
  inputs: z.array(inputsSchema).min(1, "At least one input is required"),
  outputs: z.array(outputsSchema).min(1, "At least one output is required"),
  model: z.string().min(1, "Model identifier cannot be empty"),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  demonstrations: nodeDatasetSchema.optional(),
  promptingTechnique: promptingTechniqueSchema.optional(),
  responseFormat: responseFormatSchema.optional(),
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
