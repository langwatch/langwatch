/**
 * The wire shapes the `/api/api-keys` REST family publishes — narrower
 * than the stored key: neither the hashed secret nor the lookup id ever
 * leaves this door. `bindings` is the write shape `roleBindings` reads back.
 */
import { projectRestDetailSchema, projectRestSchema } from "@langwatch/project-contract";
import { z } from "zod";

import {
  apiKeyPermissionFormatSchema,
  apiKeyRoleSchema,
  apiKeyScopeTypeSchema,
} from "./api-key.ts";

const restBindingSchema = z.object({
  id: z.string().min(1),
  role: apiKeyRoleSchema,
  scopeType: apiKeyScopeTypeSchema,
  scopeId: z.string().min(1),
});

const restWritableBindingSchema = restBindingSchema.omit({ id: true });

export const apiKeyRestListItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.date(),
  expiresAt: z.date().nullable(),
  lastUsedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  roleBindings: z.array(restBindingSchema),
});
export type ApiKeyRestListItem = z.infer<typeof apiKeyRestListItemSchema>;

export const apiKeyRestListSchema = z.object({
  data: z.array(apiKeyRestListItemSchema.meta({ id: "ApiKeyInfo" })),
});

export const apiKeyRestDetailSchema = z.object({
  ...apiKeyRestListItemSchema.shape,
  keyType: z.enum(["personal", "service"]),
  assignedToUserId: z.string().nullable(),
  createdByUserId: z.string().nullable(),
  permissionMode: z.string(),
  permissions: z.array(apiKeyPermissionFormatSchema),
  bindings: z.array(restWritableBindingSchema),
});
export type ApiKeyRestDetail = z.infer<typeof apiKeyRestDetailSchema>;

/** The mint's one-time answer: the plaintext token, and what it belongs to. */
export const apiKeyRestMintedSchema = z.object({
  token: z.string().min(1),
  apiKey: z.object({
    id: z.string().min(1),
    name: z.string(),
    createdAt: z.date(),
  }),
});
export type ApiKeyRestMinted = z.infer<typeof apiKeyRestMintedSchema>;

/** What a revoke answers. */
export const apiKeyRestRevokedSchema = z.object({ success: z.boolean() });

// `/api/projects`, served by api-key at project's path (R3, R10).

/**
 * The `Project` component the generated clients name their type after: the listing's shape, and
 * the PII level a single project's own GET and PATCH add.
 */
const projectRestComponentSchema = projectRestSchema
  .safeExtend({ piiRedactionLevel: projectRestDetailSchema.shape.piiRedactionLevel.optional() })
  .meta({ id: "Project" });

/** A page of them, with the count the caller pages through. */
export const projectRestPageSchema = z
  .object({
    data: z.array(projectRestComponentSchema),
    pagination: z
      .object({
        page: z.number().int().positive(),
        limit: z.number().int().positive(),
        total: z.number().int().nonnegative(),
      })
      .strict()
      .meta({ id: "Pagination" }),
  })
  .strict();
export type ProjectRestPage = z.infer<typeof projectRestPageSchema>;

/**
 * A freshly created project, with the service key minted alongside it. The
 * token is shown once, on this response only.
 */
export const projectRestCreatedSchema = projectRestSchema.safeExtend({
  serviceApiKey: z.string().min(1),
  serviceApiKeyId: z.string().min(1),
});
export type ProjectRestCreated = z.infer<typeof projectRestCreatedSchema>;
