import type { Named } from "@langwatch/module";
import { z } from "zod";

import { promptingTechniqueSchema } from "./prompt.field-schemas.ts";
import {
  promptHandleSchema,
  promptScopeSchema,
  promptMessageSchema,
  promptInputSchema,
  promptOutputSchema,
  type PromptConfigData,
} from "./prompt.ts";

/** Plain objects as main's tRPC create/update inputs: unknown keys are stripped, not refused. */
const promptConfigFieldsSchemaDefinition = z.object({
  prompt: z.string().optional(),
  messages: z.array(promptMessageSchema).optional(),
  inputs: z.array(promptInputSchema).optional(),
  outputs: z.array(promptOutputSchema).optional(),
  model: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  topP: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  presencePenalty: z.number().optional(),
  seed: z.number().optional(),
  topK: z.number().optional(),
  minP: z.number().optional(),
  repetitionPenalty: z.number().optional(),
  reasoning: z.string().optional(),
  verbosity: z.string().optional(),
  promptingTechnique: promptingTechniqueSchema.optional(),
  demonstrations: z.unknown().optional(),
  responseFormat: z.unknown().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});
export interface PromptConfigFieldsSchema extends Named<
  typeof promptConfigFieldsSchemaDefinition
> {}
export const promptConfigFieldsSchema: PromptConfigFieldsSchema =
  promptConfigFieldsSchemaDefinition;

const createPromptCommandSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    organizationId: z.string().min(1).optional(),
    handle: promptHandleSchema,
    scope: promptScopeSchema.optional(),
    authorId: z.string().optional(),
    commitMessage: z.string().nullable().optional(),
  })
  .safeExtend(promptConfigFieldsSchema.shape);
export interface CreatePromptCommandSchema extends Named<
  typeof createPromptCommandSchemaDefinition
> {}
export const createPromptCommandSchema: CreatePromptCommandSchema =
  createPromptCommandSchemaDefinition;
export type CreatePromptCommand = z.infer<typeof createPromptCommandSchema>;

const updatePromptCommandSchemaDefinition = z.object({
  idOrHandle: z.string().min(1),
  projectId: z.string().min(1),
  data: z
    .object({ authorId: z.string().optional(), commitMessage: z.string().min(1) })
    .safeExtend(promptConfigFieldsSchema.shape),
});
export interface UpdatePromptCommandSchema extends Named<
  typeof updatePromptCommandSchemaDefinition
> {}
export const updatePromptCommandSchema: UpdatePromptCommandSchema =
  updatePromptCommandSchemaDefinition;
export type UpdatePromptCommand = z.infer<typeof updatePromptCommandSchema>;

const updatePromptHandleCommandSchemaDefinition = z.object({
  idOrHandle: z.string().min(1),
  projectId: z.string().min(1),
  data: z.object({ handle: promptHandleSchema, scope: promptScopeSchema }),
});
export interface UpdatePromptHandleCommandSchema extends Named<
  typeof updatePromptHandleCommandSchemaDefinition
> {}
export const updatePromptHandleCommandSchema: UpdatePromptHandleCommandSchema =
  updatePromptHandleCommandSchemaDefinition;
export type UpdatePromptHandleCommand = z.infer<typeof updatePromptHandleCommandSchema>;

const promptReferenceSchemaDefinition = z
  .object({
    idOrHandle: z.string().min(1),
    projectId: z.string().min(1),
    version: z.number().int().positive().optional(),
    versionId: z.string().optional(),
    tag: z.string().optional(),
  })
  .strict();
export interface PromptReferenceSchema extends Named<typeof promptReferenceSchemaDefinition> {}
export const promptReferenceSchema: PromptReferenceSchema = promptReferenceSchemaDefinition;
export type PromptReference = z.infer<typeof promptReferenceSchema>;

const copyPromptCommandSchemaDefinition = z.object({
  idOrHandle: z.string().min(1),
  sourceProjectId: z.string().min(1),
  targetProjectId: z.string().min(1),
  authorId: z.string().optional(),
});
export interface CopyPromptCommandSchema extends Named<typeof copyPromptCommandSchemaDefinition> {}
export const copyPromptCommandSchema: CopyPromptCommandSchema = copyPromptCommandSchemaDefinition;
export type CopyPromptCommand = z.infer<typeof copyPromptCommandSchema>;

export type PromptConfigFields = z.infer<typeof promptConfigFieldsSchema> &
  Partial<PromptConfigData>;

/** Prompt's own lifecycle facts, which peers react to from their own side (§9). */
export const PROMPT_CREATED_EVENT_TYPE = "lw.prompt.created" as const;

/** A project gained a prompt (write, copy or sync), the org-wide count including it, and when. */
const promptCreatedEventDataSchemaDefinition = z.object({
  promptId: z.string(),
  projectId: z.string(),
  userId: z.string(),
  orgPromptCount: z.number().int().positive(),
  occurredAt: z.number().int().nonnegative(),
});
export interface PromptCreatedEventDataSchema extends Named<
  typeof promptCreatedEventDataSchemaDefinition
> {}
export const promptCreatedEventDataSchema: PromptCreatedEventDataSchema =
  promptCreatedEventDataSchemaDefinition;
export type PromptCreatedEventData = z.infer<typeof promptCreatedEventDataSchema>;
