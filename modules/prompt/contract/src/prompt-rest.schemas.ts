import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  commitMessageSchema,
  handleSchema,
  inputsSchema,
  messageSchema,
  modelNameSchema,
  nulFreeStringSchema,
  outputsSchema,
  runtimeParametersSchema,
  schemaVersionSchema,
  scopeSchema,
  versionSchema,
} from "./prompt.field-schemas.ts";
import { getLatestConfigVersionSchema } from "./prompt.version-schema.ts";

const createPromptInputSchemaDefinition = z
  .strictObject({
    handle: handleSchema,
    scope: scopeSchema.optional().default("PROJECT"),
    model: modelNameSchema.optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
    commitMessage: commitMessageSchema.optional(),
    authorId: nulFreeStringSchema.optional(),
    prompt: nulFreeStringSchema.optional(),
    messages: z.array(messageSchema).optional(),
    inputs: z.array(inputsSchema).optional(),
    outputs: z.array(outputsSchema).optional(),
    schemaVersion: schemaVersionSchema.optional(),
    tags: z.array(nulFreeStringSchema.min(1)).optional(),
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
export interface CreatePromptInputSchema extends Named<typeof createPromptInputSchemaDefinition> {}
export const createPromptInputSchema: CreatePromptInputSchema = createPromptInputSchemaDefinition;

const updatePromptInputSchemaDefinition = z.strictObject({
  ...createPromptInputSchema.omit({ scope: true, handle: true }).shape,
  commitMessage: commitMessageSchema,
  scope: scopeSchema.optional(),
  handle: handleSchema.optional(),
});
export interface UpdatePromptInputSchema extends Named<typeof updatePromptInputSchemaDefinition> {}
export const updatePromptInputSchema: UpdatePromptInputSchema = updatePromptInputSchemaDefinition;

const updateHandleInputSchemaDefinition = z.strictObject({
  handle: handleSchema,
  scope: scopeSchema,
});
export interface UpdateHandleInputSchema extends Named<typeof updateHandleInputSchemaDefinition> {}
export const updateHandleInputSchema: UpdateHandleInputSchema = updateHandleInputSchemaDefinition;

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

const apiResponsePromptTagSchemaDefinition = z.object({
  name: z.string(),
  versionId: z.string(),
});
export interface ApiResponsePromptTagSchema extends Named<
  typeof apiResponsePromptTagSchemaDefinition
> {}
export const apiResponsePromptTagSchema: ApiResponsePromptTagSchema =
  apiResponsePromptTagSchemaDefinition;

const apiResponseVersionOutputSchemaDefinition = z.object({
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
export interface ApiResponseVersionOutputSchema extends Named<
  typeof apiResponseVersionOutputSchemaDefinition
> {}
export const apiResponseVersionOutputSchema: ApiResponseVersionOutputSchema =
  apiResponseVersionOutputSchemaDefinition;

const apiResponsePromptWithVersionDataSchemaDefinition = z.object({
  ...apiResponsePromptSchemaBase.shape,
  ...apiResponseVersionOutputSchema.omit({ configId: true }).shape,
});
export interface ApiResponsePromptWithVersionDataSchema extends Named<
  typeof apiResponsePromptWithVersionDataSchemaDefinition
> {}
export const apiResponsePromptWithVersionDataSchema: ApiResponsePromptWithVersionDataSchema =
  apiResponsePromptWithVersionDataSchemaDefinition;
export type ApiResponsePrompt = z.infer<typeof apiResponsePromptWithVersionDataSchema>;

const promptWireSchemaDefinition = z.object({
  ...apiResponsePromptWithVersionDataSchema.shape,
  platformUrl: z.string(),
});
export interface PromptWireSchema extends Named<typeof promptWireSchemaDefinition> {}
export const promptWireSchema: PromptWireSchema = promptWireSchemaDefinition;

const assignTagResponseSchemaDefinition = z.object({
  configId: z.string(),
  versionId: z.string(),
  tag: z.string(),
  updatedAt: z.date(),
});
export interface AssignTagResponseSchema extends Named<typeof assignTagResponseSchemaDefinition> {}
export const assignTagResponseSchema: AssignTagResponseSchema = assignTagResponseSchemaDefinition;
const assignTagInputSchemaDefinition = z.object({ versionId: nulFreeStringSchema });
export interface AssignTagInputSchema extends Named<typeof assignTagInputSchemaDefinition> {}
export const assignTagInputSchema: AssignTagInputSchema = assignTagInputSchemaDefinition;
const tagDefinitionSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.coerce.date(),
});
export interface TagDefinitionSchema extends Named<typeof tagDefinitionSchemaDefinition> {}
export const tagDefinitionSchema: TagDefinitionSchema = tagDefinitionSchemaDefinition;
const createTagInputSchemaDefinition = z.object({ name: nulFreeStringSchema });
export interface CreateTagInputSchema extends Named<typeof createTagInputSchemaDefinition> {}
export const createTagInputSchema: CreateTagInputSchema = createTagInputSchemaDefinition;
const renameTagInputSchemaDefinition = z.object({ name: nulFreeStringSchema });
export interface RenameTagInputSchema extends Named<typeof renameTagInputSchemaDefinition> {}
export const renameTagInputSchema: RenameTagInputSchema = renameTagInputSchemaDefinition;
const syncInputSchemaDefinition = z.object({
  configData: getLatestConfigVersionSchema().shape.configData,
  parameters: z.record(z.string(), z.unknown()).optional(),
  localVersion: versionSchema.optional(),
  commitMessage: commitMessageSchema.optional(),
});
export interface SyncInputSchema extends Named<typeof syncInputSchemaDefinition> {}
export const syncInputSchema: SyncInputSchema = syncInputSchemaDefinition;
const documentedSyncResultSchemaDefinition = z.object({
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
export interface DocumentedSyncResultSchema extends Named<
  typeof documentedSyncResultSchemaDefinition
> {}
export const documentedSyncResultSchema: DocumentedSyncResultSchema =
  documentedSyncResultSchemaDefinition;
const idParamsSchemaDefinition = z.object({ id: nulFreeStringSchema });
export interface IdParamsSchema extends Named<typeof idParamsSchemaDefinition> {}
export const idParamsSchema: IdParamsSchema = idParamsSchemaDefinition;
const idTagParamsSchemaDefinition = z.object({
  id: nulFreeStringSchema,
  tag: nulFreeStringSchema,
});
export interface IdTagParamsSchema extends Named<typeof idTagParamsSchemaDefinition> {}
export const idTagParamsSchema: IdTagParamsSchema = idTagParamsSchemaDefinition;
const tagParamsSchemaDefinition = z.object({ tag: nulFreeStringSchema });
export interface TagParamsSchema extends Named<typeof tagParamsSchemaDefinition> {}
export const tagParamsSchema: TagParamsSchema = tagParamsSchemaDefinition;
const idVersionParamsSchemaDefinition = z.object({
  id: nulFreeStringSchema,
  versionId: nulFreeStringSchema,
});
export interface IdVersionParamsSchema extends Named<typeof idVersionParamsSchemaDefinition> {}
export const idVersionParamsSchema: IdVersionParamsSchema = idVersionParamsSchemaDefinition;

/** A restore takes no body: the prompt and version travel in the path. */
const restorePromptVersionBodySchemaDefinition = z.object({});
export interface RestorePromptVersionBodySchema extends Named<
  typeof restorePromptVersionBodySchemaDefinition
> {}
export const restorePromptVersionBodySchema: RestorePromptVersionBodySchema =
  restorePromptVersionBodySchemaDefinition;
const promptWindowQuerySchemaDefinition = z.object({
  version: z.coerce.number().int().nonnegative().optional(),
  tag: nulFreeStringSchema.optional(),
});
export interface PromptWindowQuerySchema extends Named<typeof promptWindowQuerySchemaDefinition> {}
export const promptWindowQuerySchema: PromptWindowQuerySchema = promptWindowQuerySchemaDefinition;
