import { z } from "zod";
import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

/**
 * Schema for response format specification
 * Used to define structured output formats for LLM responses
 */
export const responseFormatSchema = z.object({
  type: z.enum(["json_schema"]),
  json_schema: z.object({
    name: z.string(),
    schema: z.object({}),
  }),
});

/**
 * Base schema for LLM prompt configurations
 * This corresponds to the raw config data from the database
 */
export const llmPromptConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  updatedAt: z.date(),
});

/**
 * Schema for prompt output responses
 * Extends the base config schema with version-specific information and prompt content
 */
export const promptOutputSchema = llmPromptConfigSchema.merge(
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

/**
 * Schema for creating new prompt versions
 * Uses the latest config version schema from the repository
 */
export const versionInputSchema = getLatestConfigVersionSchema();

/**
 * Schema for version output responses
 * Extends the input schema with metadata about the created version
 */
export const versionOutputSchema = getLatestConfigVersionSchema().merge(
  z.object({
    id: z.string(),
    authorId: z.string().nullable(),
    version: z.number(),
    createdAt: z.date(),
    commitMessage: z.string().optional().nullable(),
  })
);

/**
 * Schema for unauthorized error responses
 */
export const unauthorizedSchema = z.object({
  error: z.string(),
});

/**
 * Schema for bad request error responses
 */
export const badRequestSchema = z.object({
  error: z.string(),
});

/**
 * Schema for successful operation responses
 */
export const successSchema = z.object({
  success: z.boolean(),
});
