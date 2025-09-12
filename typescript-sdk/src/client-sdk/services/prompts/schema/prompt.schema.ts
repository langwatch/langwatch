// TODO: Move these to their own files
import { z } from "zod";
import { PromptScope } from "@prisma/client";

/**
 * Zod schema for message objects in prompts
 */
export const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

/**
 * Zod schema for response format configuration
 */
export const responseFormatSchema = z.object({
  type: z.literal("json_schema"),
  json_schema: z.object({
    name: z.string(),
    schema: z.record(z.string(), z.unknown()),
  }).nullable(),
}).optional();

/**
 * Zod schema for core prompt data - the essential fields needed for functionality
 */
export const corePromptDataSchema = z.object({
  model: z.string().min(1, "Model cannot be empty"),
  messages: z.array(messageSchema).min(1, "At least one message is required"),
  prompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  responseFormat: responseFormatSchema,
});

/**
 * Zod schema for prompt metadata - optional fields for identification and tracing
 */
export const promptMetadataSchema = z.object({
  id: z.string().optional(),
  handle: z.string().nullable().optional(),
  version: z.number().positive().optional(),
  versionId: z.string().optional(),
  scope: z.enum(PromptScope).optional(),
});

/**
 * Combined schema for complete prompt data
 */
export const promptDataSchema = z.object({
  ...corePromptDataSchema.shape,
  ...promptMetadataSchema.shape,
});
