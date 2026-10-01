/** Contract schemas for the group feature's tRPC responses. */
import { z } from "zod";

import { organizationGroupGrantSchema, organizationGroupMemberSchema } from "./group.ts";

/** One access binding, with the human name of the scope it resolved to. */
export const groupGrantWithScopeNameSchema = organizationGroupGrantSchema.safeExtend({
  scopeName: z.string().nullable(),
});
export type GroupGrantWithScopeName = z.infer<typeof groupGrantWithScopeNameSchema>;

/** One row of the organization's group list. */
export const groupListItemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
    externalId: z.string().nullable(),
    scimSource: z.string().nullable(),
    memberCount: z.number().int().nonnegative(),
    grants: z.array(groupGrantWithScopeNameSchema),
    createdAt: z.date(),
  })
  .strict();
export type GroupListItem = z.infer<typeof groupListItemSchema>;

/** One group in full: its bindings, resolved, and its members. */
export const groupDetailSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
    externalId: z.string().nullable(),
    scimSource: z.string().nullable(),
    grants: z.array(groupGrantWithScopeNameSchema),
    members: z.array(organizationGroupMemberSchema),
  })
  .strict();
export type GroupDetail = z.infer<typeof groupDetailSchema>;

/** One binding as the member drawer lists it: named by scope rather than by id. */
export const groupMemberGrantViewSchema = z
  .object({
    id: z.string().min(1),
    role: organizationGroupGrantSchema.shape.role,
    customRoleName: z.string().nullable(),
    scopeType: organizationGroupGrantSchema.shape.scopeType,
    scopeName: z.string(),
  })
  .strict();
export type GroupMemberGrantView = z.infer<typeof groupMemberGrantViewSchema>;

/** One group a member belongs to, for the member drawer. */
export const groupMembershipViewSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    scimSource: z.string().nullable(),
    grants: z.array(groupMemberGrantViewSchema),
  })
  .strict();
export type GroupMembershipView = z.infer<typeof groupMembershipViewSchema>;

/** A binding was added; the caller reads it back by id. */
export const groupGrantCreatedSchema = z.object({ id: z.string().min(1) }).strict();
export type GroupGrantCreated = z.infer<typeof groupGrantCreatedSchema>;

/** A write with nothing else to report. */
export const groupWriteAckSchema = z.object({ success: z.literal(true) }).strict();
export type GroupWriteAck = z.infer<typeof groupWriteAckSchema>;
