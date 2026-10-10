import type { Named } from "@langwatch/module";
import { z } from "zod";

export const ROLE_FEATURE_ID = "role" as const;

/** The identifier prefix a newly defined custom role is written under. */
export const ROLE_KSUID_RESOURCE = "customrole";

export const ROLE_KIND = {
  CUSTOM: "custom",
  SYSTEM_API_KEY: "system_api_key",
  /** `admin`, `member` and `viewer`: in every organization, never stored, changed or deleted. */
  BUILT_IN: "built_in",
} as const;
export const roleKindSchema = z.enum(ROLE_KIND);
export type RoleKind = z.infer<typeof roleKindSchema>;

const roleSchemaDefinition = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    name: z.string(),
    description: z.string().nullable(),
    permissions: z.array(z.string()),
    kind: roleKindSchema,
    /** Null on a built-in role, which has no definition moment. */
    createdAt: z.date().nullable(),
    updatedAt: z.date().nullable(),
  })
  .strict();
export interface RoleSchema extends Named<typeof roleSchemaDefinition> {}
export const roleSchema: RoleSchema = roleSchemaDefinition;
export type Role = z.infer<typeof roleSchema>;

/**
 * What a write to the role surface answers when there is nothing to hand back:
 * the write happened. Same shape for a definition removed and for a role given
 * or taken away, so no caller learns anything from the difference.
 */
const roleWriteAcknowledgedSchemaDefinition = z.object({ success: z.literal(true) }).strict();
export interface RoleWriteAcknowledgedSchema extends Named<
  typeof roleWriteAcknowledgedSchemaDefinition
> {}
export const roleWriteAcknowledgedSchema: RoleWriteAcknowledgedSchema =
  roleWriteAcknowledgedSchemaDefinition;
export type RoleWriteAcknowledged = z.infer<typeof roleWriteAcknowledgedSchema>;

const roleUpdateSchemaDefinition = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    permissions: z.array(z.string()).min(1).optional(),
  })
  .strict();
export interface RoleUpdateSchema extends Named<typeof roleUpdateSchemaDefinition> {}
export const roleUpdateSchema: RoleUpdateSchema = roleUpdateSchemaDefinition;
export type RoleUpdate = z.infer<typeof roleUpdateSchema>;

const roleCreateSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500).nullable().optional(),
    permissions: z.array(z.string()).min(1),
  })
  .strict();
export interface RoleCreateSchema extends Named<typeof roleCreateSchemaDefinition> {}
export const roleCreateSchema: RoleCreateSchema = roleCreateSchemaDefinition;
export type RoleCreate = z.infer<typeof roleCreateSchema>;
