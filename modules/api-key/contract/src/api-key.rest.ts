/**
 * The wire shapes the `/api/api-keys` REST family publishes. Narrower than the
 * stored key on purpose: neither the hashed secret nor the lookup id ever
 * leaves this door. `bindings` is the write shape of what `roleBindings`
 * reads back, so a write followed by a read is a comparison, not a translation.
 */
import { z } from "zod";

import { apiKeyPermissionSchema, apiKeyRoleSchema, apiKeyScopeTypeSchema } from "./api-key.ts";

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

export const apiKeyRestListSchema = z.object({ data: z.array(apiKeyRestListItemSchema) });

export const apiKeyRestDetailSchema = z.object({
  ...apiKeyRestListItemSchema.shape,
  keyType: z.enum(["personal", "service"]),
  assignedToUserId: z.string().nullable(),
  createdByUserId: z.string().nullable(),
  permissionMode: z.string(),
  permissions: z.array(apiKeyPermissionSchema),
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
