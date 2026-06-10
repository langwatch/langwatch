import { z } from "zod";

const scopeAttachmentSchema = z.object({
  scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
  scopeId: z.string().min(1),
});

/**
 * Body of POST /api/model-defaults. The JSON payload carries the
 * model-per-role / model-per-feature-key entries; absence of a key
 * means "inherit from a higher scope" — see the cascading-default-
 * models ADR (dev/docs/adr/020). Scopes is the list of (scopeType,
 * scopeId) attachments — at least one entry required.
 */
export const createModelDefaultConfigInputSchema = z.object({
  config: z.record(z.string()),
  scopes: z.array(scopeAttachmentSchema).min(1),
});

/**
 * Body of PUT /api/model-defaults/:id. Both fields are optional —
 * caller can update just the payload or just the scope attachments.
 * Sending `scopes: []` deletes the config (an unattached config can
 * never be hit by the resolver).
 */
export const updateModelDefaultConfigInputSchema = z.object({
  config: z.record(z.string()).optional(),
  scopes: z.array(scopeAttachmentSchema).optional(),
});

const scopeRefSchema = z.object({
  type: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
  id: z.string(),
  name: z.string(),
});

const configRowSchema = z.object({
  id: z.string(),
  config: z.record(z.string()),
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

export const apiResponseModelDefaultsSchema = z.object({
  /**
   * Identity of the project this snapshot is for (echoed from the
   * API-key context) plus its team + organization. CLI / API consumers
   * use these ids to form scope refs for follow-up POST/PUT/DELETE
   * calls without a separate whoami round trip.
   */
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

export const apiResponseConfigCreatedSchema = z.object({
  id: z.string(),
});

export type CreateModelDefaultConfigInput = z.infer<
  typeof createModelDefaultConfigInputSchema
>;
export type UpdateModelDefaultConfigInput = z.infer<
  typeof updateModelDefaultConfigInputSchema
>;
export type ApiResponseModelDefaults = z.infer<
  typeof apiResponseModelDefaultsSchema
>;
