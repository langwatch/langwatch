import { z } from "zod";

import {
  commitMessageSchema,
  handleSchema,
  inputsSchema,
  messageSchema,
  modelNameSchema,
  outputsSchema,
  runtimeParametersSchema,
  schemaVersionSchema,
  scopeSchema,
  versionSchema,
} from "./prompt.field-schemas.ts";
import { getLatestConfigVersionSchema } from "./prompt.version-schema.ts";

export const createPromptInputSchema = z
  .strictObject({
    handle: handleSchema,
    scope: scopeSchema.optional().default("PROJECT"),
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
    tags: z.array(z.string().min(1)).optional(),
    parameters: runtimeParametersSchema.optional(),
  })
  // `prompt` and `messages` are each optional but the handler needs one of
  // them, which a shape alone cannot say. The example is where a reader — and
  // any client generated from this document — learns what a working body is.
  .meta({
    examples: [
      {
        handle: "support/tone-check",
        prompt: "You are a helpful assistant. Answer in one short paragraph.",
      },
    ],
  });

export const updatePromptInputSchema = z.strictObject({
  ...createPromptInputSchema.omit({ scope: true, handle: true }).shape,
  commitMessage: commitMessageSchema,
  scope: scopeSchema.optional(),
  handle: handleSchema.optional(),
});

export const updateHandleInputSchema = z.strictObject({
  handle: handleSchema,
  scope: scopeSchema,
});

const configDataSchema = getLatestConfigVersionSchema().shape.configData;

const apiResponsePromptSchemaBase = z.object({
  id: z.string(),
  handle: z.string().nullable(),
  scope: scopeSchema,
  name: z.string(),
  updatedAt: z.date(),
  projectId: z.string(),
  organizationId: z.string(),
});

export const apiResponsePromptTagSchema = z.object({
  name: z.string(),
  versionId: z.string(),
});

export const apiResponseVersionOutputSchema = z.object({
  configId: z.string(),
  projectId: z.string(),
  versionId: z.string(),
  authorId: z.string().nullable().optional(),
  version: z.number(),
  createdAt: z.date(),
  commitMessage: z.string().optional().nullable(),
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
  tags: z.array(apiResponsePromptTagSchema).default([]),
  parameters: runtimeParametersSchema,
});

export const apiResponsePromptWithVersionDataSchema = z.object({
  ...apiResponsePromptSchemaBase.shape,
  ...apiResponseVersionOutputSchema.omit({ configId: true }).shape,
});
export type ApiResponsePrompt = z.infer<typeof apiResponsePromptWithVersionDataSchema>;

export const promptWireSchema = z.object({
  ...apiResponsePromptWithVersionDataSchema.shape,
  platformUrl: z.string(),
});

export const assignTagResponseSchema = z.object({
  configId: z.string(),
  versionId: z.string(),
  tag: z.string(),
  updatedAt: z.date(),
});
export const assignTagInputSchema = z.object({ versionId: z.string() });
export const tagDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.coerce.date().optional(),
});
export const createTagInputSchema = z.object({ name: z.string() });
export const renameTagInputSchema = z.object({ name: z.string() });
export const syncInputSchema = z.object({
  configData: getLatestConfigVersionSchema().shape.configData,
  parameters: z.record(z.string(), z.unknown()).optional(),
  localVersion: versionSchema.optional(),
  commitMessage: commitMessageSchema.optional(),
});
export const documentedSyncResultSchema = z.object({
  action: z.enum(["created", "updated", "conflict", "up_to_date"]),
  prompt: apiResponsePromptWithVersionDataSchema.optional(),
  conflictInfo: z
    .object({
      localVersion: z.number(),
      remoteVersion: z.number(),
      differences: z.array(z.string()),
      remoteConfigData: getLatestConfigVersionSchema().shape.configData,
      remoteParameters: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});
export const idParamsSchema = z.object({ id: z.string() });
export const idTagParamsSchema = z.object({ id: z.string(), tag: z.string() });
export const tagParamsSchema = z.object({ tag: z.string() });
export const idVersionParamsSchema = z.object({ id: z.string(), versionId: z.string() });

/** A restore takes no body: the prompt and version travel in the path. */
export const restorePromptVersionBodySchema = z.object({});
export const promptWindowQuerySchema = z.object({
  version: z.coerce.number().int().nonnegative().optional(),
  tag: z.string().optional(),
});
