/**
 * The input parsers of the `/api/api-keys` REST family. Written here beside the
 * response shapes in `api-key.rest.ts` so one file states what the door accepts
 * and the other what it answers, and the published document derives both.
 */
import { z } from "zod";

import { apiKeyPermissionSchema, apiKeyRoleSchema, apiKeyScopeTypeSchema } from "./api-key.ts";
import { API_KEY_PERMISSION_MODES, refineRestrictedPermissions } from "./api-key.permissions.ts";

const bindingSchema = z.object({
  role: apiKeyRoleSchema.describe(
    "CUSTOM grants exactly the listed permissions and requires permissionMode 'restricted'.",
  ),
  scopeType: apiKeyScopeTypeSchema,
  scopeId: z.string().min(1),
});

/** One binding as a write states it. */
export type ApiKeyRestBinding = z.infer<typeof bindingSchema>;

const permissionsSchema = z
  .array(apiKeyPermissionSchema)
  .describe(
    "Restricted mode only: the exact resource:action permissions the key's CUSTOM bindings grant.",
  );

const permissionModeSchema = z
  .enum(API_KEY_PERMISSION_MODES)
  .describe(
    "'all' and 'readonly' take their meaning from the bindings alone; 'restricted' additionally requires an explicit permissions list.",
  );

/** The key named in the path of every by-id route. */
export const apiKeyRestParamsSchema = z.object({ id: z.string().min(1) });

export const apiKeyRestCreateSchema = z
  .object({
    keyType: z
      .enum(["personal", "service"])
      .default("personal")
      .describe(
        "A personal key acts as the user who created it and needs explicit bindings. A service key is not tied to a user.",
      ),
    name: z.string().min(1).max(100).describe("Human-readable name for this key"),
    description: z.string().max(500).optional(),
    expiresAt: z.coerce
      .date()
      .optional()
      .describe("ISO 8601 timestamp after which the key stops working"),
    assignedToUserId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Organization admins only: the member who owns the key and whose access caps it. Defaults to the caller.",
      ),
    permissionMode: permissionModeSchema.default("all"),
    permissions: permissionsSchema.optional(),
    bindings: z
      .array(bindingSchema)
      .max(20)
      .optional()
      .describe("What this key may do, and where. Required for a personal key."),
    projectIds: z
      .array(z.string().min(1))
      .max(50)
      .optional()
      .describe("Service keys only: restricts the key to these projects"),
  })
  .refine((data) => data.keyType === "service" || (data.bindings && data.bindings.length > 0), {
    message: "bindings are required for personal keys",
    path: ["bindings"],
  })
  .refine(
    (data) => data.keyType === "service" || !data.projectIds || data.projectIds.length === 0,
    {
      message: "projectIds is only supported for service keys; use bindings instead",
      path: ["projectIds"],
    },
  )
  .superRefine(refineRestrictedPermissions);
export type ApiKeyRestCreate = z.infer<typeof apiKeyRestCreateSchema>;

export const apiKeyRestUpdateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullish(),
    permissionMode: permissionModeSchema.optional(),
    permissions: permissionsSchema.optional(),
    bindings: z
      .array(bindingSchema)
      .min(1)
      .max(20)
      .optional()
      .describe(
        "Replaces the key's bindings outright. Whatever is accepted here is exactly what a subsequent GET returns.",
      ),
  })
  .superRefine(refineRestrictedPermissions);
export type ApiKeyRestUpdate = z.infer<typeof apiKeyRestUpdateSchema>;
