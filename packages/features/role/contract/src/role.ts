import { z } from "zod";

export const ROLE_FEATURE_ID = "role" as const;

export const ROLE_KIND = {
  CUSTOM: "custom",
  SYSTEM_API_KEY: "system_api_key",
} as const;
export const roleKindSchema = z.enum(ROLE_KIND);
export type RoleKind = z.infer<typeof roleKindSchema>;

export const roleBindingScopeTypeSchema = z.enum(["ORGANIZATION", "TEAM", "PROJECT"]);
export type RoleBindingScopeType = z.infer<typeof roleBindingScopeTypeSchema>;

export const roleSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    name: z.string(),
    description: z.string().nullable(),
    permissions: z.array(z.string()),
    kind: roleKindSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type Role = z.infer<typeof roleSchema>;

export const roleUpdateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    permissions: z.array(z.string()).min(1).optional(),
  })
  .strict();
export type RoleUpdate = z.infer<typeof roleUpdateSchema>;

export const roleCreateSchema = z
  .object({
    organizationId: z.string().min(1),
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500).nullable().optional(),
    permissions: z.array(z.string()).min(1),
  })
  .strict();
export type RoleCreate = z.infer<typeof roleCreateSchema>;

export const customRoleBindingSchema = z
  .object({
    customRoleId: z.string().min(1),
    scopeType: roleBindingScopeTypeSchema,
  })
  .strict();
