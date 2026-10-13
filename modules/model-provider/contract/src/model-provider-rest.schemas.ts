import type { Named } from "@langwatch/module";
/**
 * Wire schemas for model-provider module REST families — published promises
 * enforced in contract. Relocated from server-local `*.rules.ts` files so the
 * transport layer imports schemas from this package and only this package.
 */
import { z } from "zod";

import { customModelEntrySchema } from "./custom-model.ts";

// ─────────────────────────────────────────────────────────────────────────────
// `/api/model-providers`
// ─────────────────────────────────────────────────────────────────────────────

/** The path parameter naming the provider a write is keyed on. */
const modelProviderRestParamsSchemaDefinition = z.object({ provider: z.string().min(1) });
export interface ModelProviderRestParamsSchema extends Named<
  typeof modelProviderRestParamsSchemaDefinition
> {}
export const modelProviderRestParamsSchema: ModelProviderRestParamsSchema =
  modelProviderRestParamsSchemaDefinition;

const updateModelProviderInputSchemaDefinition = z.object({
  enabled: z.boolean(),
  customKeys: z.record(z.string(), z.unknown()).optional(),
  customModels: z.union([z.array(customModelEntrySchema), z.array(z.string())]).optional(),
  customEmbeddingsModels: z
    .union([z.array(customModelEntrySchema), z.array(z.string())])
    .optional(),
  extraHeaders: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
  defaultModel: z.string().optional(),
});
export interface UpdateModelProviderInputSchema extends Named<
  typeof updateModelProviderInputSchemaDefinition
> {}
export const updateModelProviderInputSchema: UpdateModelProviderInputSchema =
  updateModelProviderInputSchemaDefinition;

const extraHeaderSchema = z.object({
  key: z.string(),
  value: z.string(),
});

/** One model provider entry, as this family's response has always published it. */
const apiResponseModelProviderSchemaDefinition = z.object({
  id: z.string().optional(),
  provider: z.string(),
  enabled: z.boolean(),
  customKeys: z.record(z.string(), z.unknown()).nullable(),
  deploymentMapping: z.unknown().nullable(),
  models: z.array(z.string()).nullable().optional(),
  embeddingsModels: z.array(z.string()).nullable().optional(),
  customModels: z.array(customModelEntrySchema).nullable().optional(),
  customEmbeddingsModels: z.array(customModelEntrySchema).nullable().optional(),
  disabledByDefault: z.boolean().optional(),
  extraHeaders: z.array(extraHeaderSchema).nullable().optional(),
});
export interface ApiResponseModelProviderSchema extends Named<
  typeof apiResponseModelProviderSchemaDefinition
> {}
export const apiResponseModelProviderSchema: ApiResponseModelProviderSchema =
  apiResponseModelProviderSchemaDefinition;

export type ApiResponseModelProvider = z.infer<typeof apiResponseModelProviderSchema>;

/** A record mapping provider keys to their configuration. */
const apiResponseModelProvidersSchemaDefinition = z
  .object({})
  .catchall(apiResponseModelProviderSchema);
export interface ApiResponseModelProvidersSchema extends Named<
  typeof apiResponseModelProvidersSchemaDefinition
> {}
export const apiResponseModelProvidersSchema: ApiResponseModelProvidersSchema =
  apiResponseModelProvidersSchemaDefinition;

export type ApiResponseModelProviders = z.infer<typeof apiResponseModelProvidersSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// `/api/model-defaults`
// ─────────────────────────────────────────────────────────────────────────────

/** The path parameter every item address of this family names. */
const modelDefaultsRestParamsSchemaDefinition = z.object({ id: z.string().min(1) });
export interface ModelDefaultsRestParamsSchema extends Named<
  typeof modelDefaultsRestParamsSchemaDefinition
> {}
export const modelDefaultsRestParamsSchema: ModelDefaultsRestParamsSchema =
  modelDefaultsRestParamsSchemaDefinition;

const scopeAttachmentSchema = z.object({
  scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
  scopeId: z.string().min(1),
});

/**
 * Body of POST /api/model-defaults. Absence of a key means "inherit from a
 * higher scope" — see the cascading-default-models ADR (dev/docs/adr/020).
 * `scopes` is the (scopeType, scopeId) attachment list; at least one required.
 */
const createModelDefaultConfigInputSchemaDefinition = z.object({
  config: z.record(z.string(), z.string()),
  scopes: z.array(scopeAttachmentSchema).min(1),
});
export interface CreateModelDefaultConfigInputSchema extends Named<
  typeof createModelDefaultConfigInputSchemaDefinition
> {}
export const createModelDefaultConfigInputSchema: CreateModelDefaultConfigInputSchema =
  createModelDefaultConfigInputSchemaDefinition;

/**
 * Body of PUT /api/model-defaults/:id. Both fields are optional — update
 * just the payload or just the scope attachments. Sending `scopes: []`
 * deletes the config (an unattached config can never be hit by the resolver).
 */
const updateModelDefaultConfigInputSchemaDefinition = z.object({
  config: z.record(z.string(), z.string()).optional(),
  scopes: z.array(scopeAttachmentSchema).optional(),
});
export interface UpdateModelDefaultConfigInputSchema extends Named<
  typeof updateModelDefaultConfigInputSchemaDefinition
> {}
export const updateModelDefaultConfigInputSchema: UpdateModelDefaultConfigInputSchema =
  updateModelDefaultConfigInputSchemaDefinition;

const scopeRefSchema = z.object({
  type: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
  id: z.string(),
  name: z.string(),
});

const configRowSchema = z.object({
  id: z.string(),
  config: z.record(z.string(), z.string()),
  scopes: z.array(scopeRefSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const effectiveResolutionSchema = z
  .object({
    model: z.string(),
    source: z.string(),
    scope: z.string().nullable(),
  })
  .nullable();

const apiResponseModelDefaultsSchemaDefinition = z.object({
  scope: z.object({
    projectId: z.string(),
    teamId: z.string().nullable(),
    organizationId: z.string().nullable(),
    organizationName: z.string().nullable(),
  }),
  effective: z.object({
    DEFAULT: effectiveResolutionSchema,
    FAST: effectiveResolutionSchema,
    EMBEDDINGS: effectiveResolutionSchema,
  }),
  configs: z.array(configRowSchema),
});
export interface ApiResponseModelDefaultsSchema extends Named<
  typeof apiResponseModelDefaultsSchemaDefinition
> {}
export const apiResponseModelDefaultsSchema: ApiResponseModelDefaultsSchema =
  apiResponseModelDefaultsSchemaDefinition;

const apiResponseConfigCreatedSchemaDefinition = z.object({
  id: z.string(),
});
export interface ApiResponseConfigCreatedSchema extends Named<
  typeof apiResponseConfigCreatedSchemaDefinition
> {}
export const apiResponseConfigCreatedSchema: ApiResponseConfigCreatedSchema =
  apiResponseConfigCreatedSchemaDefinition;

export type CreateModelDefaultConfigInput = z.infer<typeof createModelDefaultConfigInputSchema>;
export type UpdateModelDefaultConfigInput = z.infer<typeof updateModelDefaultConfigInputSchema>;
export type ApiResponseModelDefaults = z.infer<typeof apiResponseModelDefaultsSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// `/api/playground`
// ─────────────────────────────────────────────────────────────────────────────

/** The conversation posted by the browser; project and model remain request headers. */
const playgroundRestBodySchemaDefinition = z.object({
  messages: z.array(z.unknown()),
});
export interface PlaygroundRestBodySchema extends Named<
  typeof playgroundRestBodySchemaDefinition
> {}
export const playgroundRestBodySchema: PlaygroundRestBodySchema =
  playgroundRestBodySchemaDefinition;

/** The target and optional system prompt carried by the released playground wire contract. */
const playgroundRestHeadersSchemaDefinition = z.object({
  "x-project-id": z.string().nullable().optional(),
  "x-model": z.string().nullable().optional(),
  "x-system-prompt": z.string().nullable().optional(),
});
export interface PlaygroundRestHeadersSchema extends Named<
  typeof playgroundRestHeadersSchemaDefinition
> {}
export const playgroundRestHeadersSchema: PlaygroundRestHeadersSchema =
  playgroundRestHeadersSchemaDefinition;
