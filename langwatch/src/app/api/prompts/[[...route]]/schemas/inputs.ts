import { PromptScope } from "@prisma/client";
import { z } from "zod";
import {
  commitMessageSchema,
  handleSchema,
  inputsSchema,
  messageSchema,
  modelNameSchema,
  outputsSchema,
  schemaVersionSchema,
  scopeSchema,
} from "~/prompts/schemas/field-schemas";
import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

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
    handle: true,
  })
  .merge(
    z.strictObject({
      // commitMessage is required for updates (creates new version)
      commitMessage: commitMessageSchema,
      // Scope is optional, but on the update we don't want to set the default
      scope: scopeSchema.optional(),
      handle: handleSchema.optional(),
    }),
  );

export const updateHandleInputSchema = z.strictObject({
  handle: handleSchema,
  scope: scopeSchema,
});
