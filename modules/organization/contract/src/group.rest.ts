/**
 * The wire shapes the `/api/groups` REST family publishes — narrower than the
 * domain shapes: a group answers without `organizationId`/`updatedAt`, and a
 * member without its avatar.
 */
import { z } from "zod";

import {
  organizationGroupBindingInputSchema,
  organizationGroupBindingSchema,
  organizationGroupMemberSchema,
  organizationGroupSchema,
} from "./group.ts";

export const organizationGroupRestMemberSchema = organizationGroupMemberSchema.omit({
  image: true,
});
export type OrganizationGroupRestMember = z.infer<typeof organizationGroupRestMemberSchema>;

export const organizationGroupRestSummarySchema = organizationGroupSchema
  .omit({ organizationId: true, updatedAt: true })
  .safeExtend({
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
  .safeExtend({
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

/** The page a listing asks for, as query string values arrive - strings, coerced. */
export const organizationGroupRestListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

/** A new group, with the bindings and members it starts life holding. */
export const organizationGroupRestCreateSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(100),
  bindings: z.array(organizationGroupBindingInputSchema).optional(),
  memberIds: z.array(z.string()).optional(),
});

/** The only field a group rename changes. */
export const organizationGroupRestRenameSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

/** The member a group gains. */
export const organizationGroupRestAddMemberSchema = z.object({
  userId: z.string().min(1, "userId is required"),
});

export const organizationGroupRestParamsSchema = z.object({ groupId: z.string().min(1) });

export const organizationGroupRestMemberParamsSchema = z.object({
  ...organizationGroupRestParamsSchema.shape,
  userId: z.string().min(1),
});

export const organizationGroupRestBindingParamsSchema = z.object({
  ...organizationGroupRestParamsSchema.shape,
  bindingId: z.string().min(1),
});
