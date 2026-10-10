import type { Named } from "@langwatch/module";
/**
 * The wire shapes the `/api/groups` REST family publishes — narrower than the
 * domain shapes: a group answers without `organizationId`/`updatedAt`, and a
 * member without its avatar.
 */
import { z } from "zod";

import {
  organizationGroupGrantInputSchema,
  organizationGroupGrantSchema,
  organizationGroupMemberSchema,
  organizationGroupSchema,
} from "./group.ts";

const organizationGroupRestMemberSchemaDefinition = organizationGroupMemberSchema.omit({
  image: true,
});
export interface OrganizationGroupRestMemberSchema extends Named<
  typeof organizationGroupRestMemberSchemaDefinition
> {}
export const organizationGroupRestMemberSchema: OrganizationGroupRestMemberSchema =
  organizationGroupRestMemberSchemaDefinition;
export type OrganizationGroupRestMember = z.infer<typeof organizationGroupRestMemberSchema>;

const organizationGroupRestSummarySchemaDefinition = organizationGroupSchema
  .omit({ organizationId: true, updatedAt: true })
  .safeExtend({
    memberCount: z.number().int().nonnegative(),
    bindings: z.array(organizationGroupGrantSchema),
  });
export interface OrganizationGroupRestSummarySchema extends Named<
  typeof organizationGroupRestSummarySchemaDefinition
> {}
export const organizationGroupRestSummarySchema: OrganizationGroupRestSummarySchema =
  organizationGroupRestSummarySchemaDefinition;
export type OrganizationGroupRestSummary = z.infer<typeof organizationGroupRestSummarySchema>;

const organizationGroupRestPageSchemaDefinition = z.object({
  data: z.array(organizationGroupRestSummarySchema),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
});
export interface OrganizationGroupRestPageSchema extends Named<
  typeof organizationGroupRestPageSchemaDefinition
> {}
export const organizationGroupRestPageSchema: OrganizationGroupRestPageSchema =
  organizationGroupRestPageSchemaDefinition;
export type OrganizationGroupRestPage = z.infer<typeof organizationGroupRestPageSchema>;

const organizationGroupRestCreatedSchemaDefinition = organizationGroupSchema.omit({
  externalId: true,
  scimSource: true,
  updatedAt: true,
});
export interface OrganizationGroupRestCreatedSchema extends Named<
  typeof organizationGroupRestCreatedSchemaDefinition
> {}
export const organizationGroupRestCreatedSchema: OrganizationGroupRestCreatedSchema =
  organizationGroupRestCreatedSchemaDefinition;
export type OrganizationGroupRestCreated = z.infer<typeof organizationGroupRestCreatedSchema>;

const organizationGroupRestRenamedSchemaDefinition = organizationGroupSchema.pick({
  id: true,
  name: true,
  slug: true,
});
export interface OrganizationGroupRestRenamedSchema extends Named<
  typeof organizationGroupRestRenamedSchemaDefinition
> {}
export const organizationGroupRestRenamedSchema: OrganizationGroupRestRenamedSchema =
  organizationGroupRestRenamedSchemaDefinition;
export type OrganizationGroupRestRenamed = z.infer<typeof organizationGroupRestRenamedSchema>;

const organizationGroupRestDetailsSchemaDefinition = organizationGroupSchema
  .omit({ organizationId: true, createdAt: true, updatedAt: true })
  .safeExtend({
    members: z.array(organizationGroupRestMemberSchema),
    bindings: z.array(organizationGroupGrantSchema),
  });
export interface OrganizationGroupRestDetailsSchema extends Named<
  typeof organizationGroupRestDetailsSchemaDefinition
> {}
export const organizationGroupRestDetailsSchema: OrganizationGroupRestDetailsSchema =
  organizationGroupRestDetailsSchemaDefinition;
export type OrganizationGroupRestDetails = z.infer<typeof organizationGroupRestDetailsSchema>;

const organizationGroupRestMemberListSchemaDefinition = z.object({
  data: z.array(organizationGroupRestMemberSchema),
});
export interface OrganizationGroupRestMemberListSchema extends Named<
  typeof organizationGroupRestMemberListSchemaDefinition
> {}
export const organizationGroupRestMemberListSchema: OrganizationGroupRestMemberListSchema =
  organizationGroupRestMemberListSchemaDefinition;

const organizationGroupRestBindingListSchemaDefinition = z.object({
  data: z.array(organizationGroupGrantSchema),
});
export interface OrganizationGroupRestBindingListSchema extends Named<
  typeof organizationGroupRestBindingListSchemaDefinition
> {}
export const organizationGroupRestBindingListSchema: OrganizationGroupRestBindingListSchema =
  organizationGroupRestBindingListSchemaDefinition;

const organizationGroupRestBindingSchemaDefinition = organizationGroupGrantSchema.omit({
  customRoleId: true,
  customRoleName: true,
});
export interface OrganizationGroupRestBindingSchema extends Named<
  typeof organizationGroupRestBindingSchemaDefinition
> {}
export const organizationGroupRestBindingSchema: OrganizationGroupRestBindingSchema =
  organizationGroupRestBindingSchemaDefinition;

/** What every write with nothing to report answers. */
const organizationRestSuccessSchemaDefinition = z.object({ success: z.boolean() });
export interface OrganizationRestSuccessSchema extends Named<
  typeof organizationRestSuccessSchemaDefinition
> {}
export const organizationRestSuccessSchema: OrganizationRestSuccessSchema =
  organizationRestSuccessSchemaDefinition;

/** The page a listing asks for, as query string values arrive - strings, coerced. */
const organizationGroupRestListQuerySchemaDefinition = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});
export interface OrganizationGroupRestListQuerySchema extends Named<
  typeof organizationGroupRestListQuerySchemaDefinition
> {}
export const organizationGroupRestListQuerySchema: OrganizationGroupRestListQuerySchema =
  organizationGroupRestListQuerySchemaDefinition;

/** A new group, with the bindings and members it starts life holding. */
const organizationGroupRestCreateSchemaDefinition = z.object({
  name: z.string().trim().min(1, "name is required").max(100),
  bindings: z.array(organizationGroupGrantInputSchema).optional(),
  memberIds: z.array(z.string()).optional(),
});
export interface OrganizationGroupRestCreateSchema extends Named<
  typeof organizationGroupRestCreateSchemaDefinition
> {}
export const organizationGroupRestCreateSchema: OrganizationGroupRestCreateSchema =
  organizationGroupRestCreateSchemaDefinition;

/** The only field a group rename changes. */
const organizationGroupRestRenameSchemaDefinition = z.object({
  name: z.string().trim().min(1).max(100),
});
export interface OrganizationGroupRestRenameSchema extends Named<
  typeof organizationGroupRestRenameSchemaDefinition
> {}
export const organizationGroupRestRenameSchema: OrganizationGroupRestRenameSchema =
  organizationGroupRestRenameSchemaDefinition;

/** The member a group gains. */
const organizationGroupRestAddMemberSchemaDefinition = z.object({
  userId: z.string().min(1, "userId is required"),
});
export interface OrganizationGroupRestAddMemberSchema extends Named<
  typeof organizationGroupRestAddMemberSchemaDefinition
> {}
export const organizationGroupRestAddMemberSchema: OrganizationGroupRestAddMemberSchema =
  organizationGroupRestAddMemberSchemaDefinition;

const organizationGroupRestParamsSchemaDefinition = z.object({ groupId: z.string().min(1) });
export interface OrganizationGroupRestParamsSchema extends Named<
  typeof organizationGroupRestParamsSchemaDefinition
> {}
export const organizationGroupRestParamsSchema: OrganizationGroupRestParamsSchema =
  organizationGroupRestParamsSchemaDefinition;

const organizationGroupRestMemberParamsSchemaDefinition = z.object({
  ...organizationGroupRestParamsSchema.shape,
  userId: z.string().min(1),
});
export interface OrganizationGroupRestMemberParamsSchema extends Named<
  typeof organizationGroupRestMemberParamsSchemaDefinition
> {}
export const organizationGroupRestMemberParamsSchema: OrganizationGroupRestMemberParamsSchema =
  organizationGroupRestMemberParamsSchemaDefinition;

const organizationGroupRestBindingParamsSchemaDefinition = z.object({
  ...organizationGroupRestParamsSchema.shape,
  bindingId: z.string().min(1),
});
export interface OrganizationGroupRestBindingParamsSchema extends Named<
  typeof organizationGroupRestBindingParamsSchemaDefinition
> {}
export const organizationGroupRestBindingParamsSchema: OrganizationGroupRestBindingParamsSchema =
  organizationGroupRestBindingParamsSchemaDefinition;
