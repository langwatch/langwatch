/**
 * The wire shapes the `/api/groups` REST family publishes.
 *
 * Narrower than the domain shapes above them on purpose: the transport answers
 * a group without its `organizationId` and `updatedAt`, and a member without
 * the avatar, so the schemas that describe those answers live here rather than
 * being the domain schema with fields the door does not send.
 */
import { z } from "zod";

import {
  organizationGroupBindingSchema,
  organizationGroupMemberSchema,
  organizationGroupSchema,
} from "./group";

export const organizationGroupRestMemberSchema = organizationGroupMemberSchema.omit({
  image: true,
});
export type OrganizationGroupRestMember = z.infer<typeof organizationGroupRestMemberSchema>;

export const organizationGroupRestSummarySchema = organizationGroupSchema
  .omit({ organizationId: true, updatedAt: true })
  .extend({
    memberCount: z.number().int().nonnegative(),
    bindings: z.array(organizationGroupBindingSchema),
  });
export type OrganizationGroupRestSummary = z.infer<typeof organizationGroupRestSummarySchema>;

export const organizationGroupRestPageSchema = z.object({
  data: z.array(organizationGroupRestSummarySchema),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
});
export type OrganizationGroupRestPage = z.infer<typeof organizationGroupRestPageSchema>;

export const organizationGroupRestCreatedSchema = organizationGroupSchema.omit({
  externalId: true,
  scimSource: true,
  updatedAt: true,
});
export type OrganizationGroupRestCreated = z.infer<typeof organizationGroupRestCreatedSchema>;

export const organizationGroupRestRenamedSchema = organizationGroupSchema.pick({
  id: true,
  name: true,
  slug: true,
});
export type OrganizationGroupRestRenamed = z.infer<typeof organizationGroupRestRenamedSchema>;

export const organizationGroupRestDetailsSchema = organizationGroupSchema
  .omit({ organizationId: true, createdAt: true, updatedAt: true })
  .extend({
    members: z.array(organizationGroupRestMemberSchema),
    bindings: z.array(organizationGroupBindingSchema),
  });
export type OrganizationGroupRestDetails = z.infer<typeof organizationGroupRestDetailsSchema>;

export const organizationGroupRestMemberListSchema = z.object({
  data: z.array(organizationGroupRestMemberSchema),
});

export const organizationGroupRestBindingListSchema = z.object({
  data: z.array(organizationGroupBindingSchema),
});

export const organizationGroupRestBindingSchema = organizationGroupBindingSchema.omit({
  customRoleId: true,
  customRoleName: true,
});

/** What every write with nothing to report answers. */
export const organizationRestSuccessSchema = z.object({ success: z.boolean() });
