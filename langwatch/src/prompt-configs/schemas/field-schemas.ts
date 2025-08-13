import { PromptScope } from "@prisma/client";
import { z } from "zod";

import { SchemaVersion } from "~/server/prompt-config/enums";

import { nodeDatasetSchema } from "~/optimization_studio/types/dsl";
import { LlmConfigInputTypes, LlmConfigOutputTypes } from "~/types";

/**
 * Schema for prompt configuration handles
 * Validates handle format: 'identifier' or 'namespace/identifier'
 * Only allows lowercase letters, numbers, hyphens, underscores and up to one slash
 */
export const handleSchema = z
  .string()
  .regex(
    /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)?$/,
    "Handle should be in the 'identifier' or 'namespace/identifier' format. Only lowercase letters, numbers, hyphens, underscores and up to one slash are allowed."
  );

/**
 * Schema for LLM message objects
 * Defines the structure for conversation messages with role and content
 */
export const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

/**
 * Schema for prompt configuration input parameters
 * Defines input fields that can be used in prompt templates
 */
export const inputsSchema = z.object({
  identifier: z.string().min(1, "Identifier cannot be empty"),
  type: z.enum(LlmConfigInputTypes),
});

/**
 * Schema for prompt configuration output parameters
 * Defines expected output structure and validation rules
 * Includes optional JSON schema for structured outputs
 */
export const outputsSchema = z.object({
  identifier: z.string().min(1, "Identifier cannot be empty"),
  type: z.enum(LlmConfigOutputTypes),
  json_schema: z
    .object({
      type: z.string().min(1, "Type cannot be empty"),
    })
    .passthrough()
    .optional(),
});

/**
 * Schema for prompting technique configuration
 * Supports different prompting strategies like few-shot learning
 * Can include demonstration datasets for technique implementation
 */
export const promptingTechniqueSchema = z.object({
  type: z.enum(["few_shot", "in_context", "chain_of_thought"]),
  demonstrations: nodeDatasetSchema.optional(),
});

/**
 * Schema for prompt configuration name
 * Validates that the name is not empty and meets basic requirements
 */
export const nameSchema = z
  .string()
  .min(1, "Name cannot be empty")
  .max(255, "Name cannot exceed 255 characters");

/**
 * Schema for prompt configuration scope
 * Defines the visibility and access level of the prompt configuration
 */
export const scopeSchema = z.nativeEnum(PromptScope);

/**
 * Schema for commit message
 */
export const commitMessageSchema = z.string();

/**
 * Schema for prompt configuration version
 */
export const versionSchema = z
  .number()
  .min(0, "Version must be greater than 0");

/**
 * Schema for response format specification
 * Used to define structured output formats for LLM responses
 */
export const responseFormatSchema = z.object({
  type: z.enum(["json_schema"]),
  json_schema: z
    .object({
      name: z.string(),
      schema: z.object({}),
    })
    .nullable(),
});

/**
 * Schema for model name
 */
export const modelNameSchema = z.string();

/**
 * Schema for schema version
 */
export const schemaVersionSchema = z.nativeEnum(SchemaVersion);
