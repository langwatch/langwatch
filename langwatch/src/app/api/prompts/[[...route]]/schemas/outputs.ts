import { PromptScope } from "@prisma/client";
import { z } from "zod";

import { nodeDatasetSchema } from "~/optimization_studio/types/dsl";
import {
  inputsSchema,
  messageSchema,
  outputsSchema,
  promptingTechniqueSchema,
  responseFormatSchema,
} from "~/prompt-configs/schemas";

/**
 * Base schema for API Response (only llm config)
 */
const apiResponsePromptWithVersionDataSchemaBase = z.object({
  id: z.string(),
  handle: z.string().nullable(),
  scope: z.nativeEnum(PromptScope),
  name: z.string(),
  updatedAt: z.date(),
  projectId: z.string(),
  organizationId: z.string(),
});

/**
 * Expected shape for a returned prompt from the API
 *
 * Includes llm config + version data
 */
export const apiResponsePromptWithVersionDataSchema =
  apiResponsePromptWithVersionDataSchemaBase.merge(
    z.object({
      version: z.number(),
      versionId: z.string(),
      versionCreatedAt: z.date(),
      model: z.string(),
      prompt: z.string(),
      messages: z.array(
        z
          .object({
            role: z.enum(["user", "assistant", "system"]),
            content: z.string(),
          })
          .passthrough()
      ),
      response_format: responseFormatSchema.nullable(),
    })
  );

export type ApiResponsePrompt = z.infer<
  typeof apiResponsePromptWithVersionDataSchema
>;

/**
 * Schema for version output responses
 * Extends the input schema with metadata about the created version
 */
export const apiResponseVersionOutputSchema = z.object({
  versionId: z.string(),
  authorId: z.string().nullable(),
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
  pramptingTechnique: promptingTechniqueSchema.optional(),
  responseFormat: responseFormatSchema.optional(),
});

export type ApiReponsePromptVersion = z.infer<
  typeof apiResponseVersionOutputSchema
>;
