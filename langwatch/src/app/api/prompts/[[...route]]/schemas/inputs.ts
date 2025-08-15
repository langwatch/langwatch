import { PromptScope } from "@prisma/client";
import { z } from "zod";

import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

import {
  handleSchema,
  scopeSchema,
  modelNameSchema,
  commitMessageSchema,
  messageSchema,
  inputsSchema,
  outputsSchema,
  schemaVersionSchema,
} from "~/prompt-configs/schemas/field-schemas";

/**
 * Schema for creating new prompt versions
 * Uses the latest config version schema from the repository
 */
export const versionInputSchema = getLatestConfigVersionSchema();

/**
 * Create prompt input schema
 */
export const createPromptInputSchema = z.strictObject({
  handle: handleSchema,
  scope: scopeSchema.optional().default(PromptScope.PROJECT),
  // Version data
  model: modelNameSchema.optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  commitMessage: commitMessageSchema.optional(),
  authorId: z.string().optional(),
  prompt: z.string().optional(),
  messages: z.array(messageSchema).optional(),
  inputs: z.array(inputsSchema).optional(),
  outputs: z.array(outputsSchema).optional(),
  schemaVersion: schemaVersionSchema.optional(),
});

export const updatePromptInputSchema = createPromptInputSchema
  .omit({
    scope: true,
  })
  .merge(
    z.object({
      // Scope is optional, but on the update we don't want to set the default
      scope: scopeSchema.optional(),
      handle: handleSchema.optional(),
    })
  );
