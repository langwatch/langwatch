import { z } from "zod";

import { organizationGroupGrantInputSchema } from "./group.ts";

/**
 * The transport inputs the group surface publishes; every call also carries
 * `organizationApiScopeSchema` from `organization.api.ts`.
 */

export const groupApiNameSchema = z.string().trim().min(1, "Group name is required").max(100);

export const groupApiGroupScopeSchema = z.object({
  organizationId: z.string(),
  groupId: z.string(),
});
export type GroupApiGroupScope = z.infer<typeof groupApiGroupScopeSchema>;

export const groupApiCreateInputSchema = z.object({
  organizationId: z.string(),
  name: groupApiNameSchema,
  grants: z.array(organizationGroupGrantInputSchema).optional(),
  memberIds: z.array(z.string()).optional(),
});
export type GroupApiCreateInput = z.infer<typeof groupApiCreateInputSchema>;

export const groupApiAddGrantInputSchema = z.object({
  organizationId: z.string(),
  groupId: z.string(),
  ...organizationGroupGrantInputSchema.shape,
});
export type GroupApiAddGrantInput = z.infer<typeof groupApiAddGrantInputSchema>;

export const groupApiRemoveGrantInputSchema = z.object({
  organizationId: z.string(),
  grantId: z.string(),
});
export type GroupApiRemoveGrantInput = z.infer<typeof groupApiRemoveGrantInputSchema>;

export const groupApiMemberInputSchema = z.object({
  organizationId: z.string(),
  groupId: z.string(),
  userId: z.string(),
});
export type GroupApiMemberInput = z.infer<typeof groupApiMemberInputSchema>;

export const groupApiRenameInputSchema = z.object({
  organizationId: z.string(),
  groupId: z.string(),
  name: groupApiNameSchema,
});
export type GroupApiRenameInput = z.infer<typeof groupApiRenameInputSchema>;

/** One member of one organization, for the groups-they-are-in read. */
export const groupApiMemberScopeSchema = z.object({
  organizationId: z.string(),
  userId: z.string(),
});
export type GroupApiMemberScope = z.infer<typeof groupApiMemberScopeSchema>;

export const groupApiApplyEditsInputSchema = z.object({
  organizationId: z.string(),
  groupId: z.string(),
  rename: z.object({ name: groupApiNameSchema }).nullable().optional(),
  grantIdsToRevoke: z.array(z.string()),
  grantsToCreate: z.array(organizationGroupGrantInputSchema),
  memberUserIdsToAdd: z.array(z.string()),
  memberUserIdsToRemove: z.array(z.string()),
});
export type GroupApiApplyEditsInput = z.infer<typeof groupApiApplyEditsInputSchema>;
