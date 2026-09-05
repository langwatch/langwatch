/**
 * What the group feature's tRPC transport answers, stated once.
 *
 * The chain declares each procedure's `withOutput` from here, so the shape a
 * client reads is written down in the contract rather than implied by
 * whatever a handler happened to return. The schemas are checked against
 * real answers in development and test; production returns the handler's
 * own value.
 */
import { z } from "zod";
import { organizationGroupBindingSchema, organizationGroupMemberSchema } from "./group";

/** One access binding, with the human name of the scope it resolved to. */
export const groupBindingWithScopeNameSchema = organizationGroupBindingSchema.extend({
  scopeName: z.string().nullable(),
});
export type GroupBindingWithScopeName = z.infer<typeof groupBindingWithScopeNameSchema>;

/** One row of the organization's group list. */
export const groupListItemSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
    externalId: z.string().nullable(),
    scimSource: z.string().nullable(),
    memberCount: z.number().int().nonnegative(),
    bindings: z.array(groupBindingWithScopeNameSchema),
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
    bindings: z.array(groupBindingWithScopeNameSchema),
    members: z.array(organizationGroupMemberSchema),
  })
  .strict();
export type GroupDetail = z.infer<typeof groupDetailSchema>;

/** One binding as the member drawer lists it: named by scope rather than by id. */
export const groupMemberBindingViewSchema = z
  .object({
    id: z.string().min(1),
    role: organizationGroupBindingSchema.shape.role,
    customRoleName: z.string().nullable(),
    scopeType: organizationGroupBindingSchema.shape.scopeType,
    scopeName: z.string(),
  })
  .strict();
export type GroupMemberBindingView = z.infer<typeof groupMemberBindingViewSchema>;

/** One group a member belongs to, for the member drawer. */
export const groupMembershipViewSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    scimSource: z.string().nullable(),
    bindings: z.array(groupMemberBindingViewSchema),
  })
  .strict();
export type GroupMembershipView = z.infer<typeof groupMembershipViewSchema>;

/** A binding was added; the caller reads it back by id. */
export const groupBindingCreatedSchema = z.object({ id: z.string().min(1) }).strict();
export type GroupBindingCreated = z.infer<typeof groupBindingCreatedSchema>;

/** A write with nothing else to report. */
export const groupWriteAckSchema = z.object({ success: z.literal(true) }).strict();
export type GroupWriteAck = z.infer<typeof groupWriteAckSchema>;
