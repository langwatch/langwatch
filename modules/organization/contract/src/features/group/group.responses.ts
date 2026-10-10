import type { Named } from "@langwatch/module";
/** Contract schemas for the group feature's tRPC responses. */
import { z } from "zod";

import { organizationGroupGrantSchema, organizationGroupMemberSchema } from "./group.ts";

/** One access binding, with the human name of the scope it resolved to. */
const groupGrantWithScopeNameSchemaDefinition = organizationGroupGrantSchema.safeExtend({
  scopeName: z.string().nullable(),
});
export interface GroupGrantWithScopeNameSchema extends Named<
  typeof groupGrantWithScopeNameSchemaDefinition
> {}
export const groupGrantWithScopeNameSchema: GroupGrantWithScopeNameSchema =
  groupGrantWithScopeNameSchemaDefinition;
export type GroupGrantWithScopeName = z.infer<typeof groupGrantWithScopeNameSchema>;

/** One row of the organization's group list. */
const groupListItemSchemaDefinition = z
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
export interface GroupListItemSchema extends Named<typeof groupListItemSchemaDefinition> {}
export const groupListItemSchema: GroupListItemSchema = groupListItemSchemaDefinition;
export type GroupListItem = z.infer<typeof groupListItemSchema>;

/** One group in full: its bindings, resolved, and its members. */
const groupDetailSchemaDefinition = z
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
export interface GroupDetailSchema extends Named<typeof groupDetailSchemaDefinition> {}
export const groupDetailSchema: GroupDetailSchema = groupDetailSchemaDefinition;
export type GroupDetail = z.infer<typeof groupDetailSchema>;

/** One binding as the member drawer lists it: named by scope rather than by id. */
const groupMemberGrantViewSchemaDefinition = z
  .object({
    id: z.string().min(1),
    role: organizationGroupGrantSchema.shape.role,
    customRoleName: z.string().nullable(),
    scopeType: organizationGroupGrantSchema.shape.scopeType,
    scopeName: z.string(),
  })
  .strict();
export interface GroupMemberGrantViewSchema extends Named<
  typeof groupMemberGrantViewSchemaDefinition
> {}
export const groupMemberGrantViewSchema: GroupMemberGrantViewSchema =
  groupMemberGrantViewSchemaDefinition;
export type GroupMemberGrantView = z.infer<typeof groupMemberGrantViewSchema>;

/** One group a member belongs to, for the member drawer. */
const groupMembershipViewSchemaDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    scimSource: z.string().nullable(),
    grants: z.array(groupMemberGrantViewSchema),
  })
  .strict();
export interface GroupMembershipViewSchema extends Named<
  typeof groupMembershipViewSchemaDefinition
> {}
export const groupMembershipViewSchema: GroupMembershipViewSchema =
  groupMembershipViewSchemaDefinition;
export type GroupMembershipView = z.infer<typeof groupMembershipViewSchema>;

/** A binding was added; the caller reads it back by id. */
const groupGrantCreatedSchemaDefinition = z.object({ id: z.string().min(1) }).strict();
export interface GroupGrantCreatedSchema extends Named<typeof groupGrantCreatedSchemaDefinition> {}
export const groupGrantCreatedSchema: GroupGrantCreatedSchema = groupGrantCreatedSchemaDefinition;
export type GroupGrantCreated = z.infer<typeof groupGrantCreatedSchema>;

/** A write with nothing else to report. */
const groupWriteAckSchemaDefinition = z.object({ success: z.literal(true) }).strict();
export interface GroupWriteAckSchema extends Named<typeof groupWriteAckSchemaDefinition> {}
export const groupWriteAckSchema: GroupWriteAckSchema = groupWriteAckSchemaDefinition;
export type GroupWriteAck = z.infer<typeof groupWriteAckSchema>;
