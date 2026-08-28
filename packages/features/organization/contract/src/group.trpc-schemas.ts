import { z } from "zod";
import { organizationGroupBindingInputSchema } from "./group";

/**
 * The transport inputs the group surface publishes. A group belongs to exactly
 * one organization, so its transport contract lives beside the
 * organization's. The organization scope every one of these calls also carries
 * is `organizationApiScopeSchema`, in `organization.api.ts`.
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
  bindings: z.array(organizationGroupBindingInputSchema).optional(),
  memberIds: z.array(z.string()).optional(),
});
export type GroupApiCreateInput = z.infer<typeof groupApiCreateInputSchema>;

export const groupApiAddBindingInputSchema = z.object({
  organizationId: z.string(),
  groupId: z.string(),
  ...organizationGroupBindingInputSchema.shape,
});
export type GroupApiAddBindingInput = z.infer<typeof groupApiAddBindingInputSchema>;

export const groupApiRemoveBindingInputSchema = z.object({
  organizationId: z.string(),
  bindingId: z.string(),
});
export type GroupApiRemoveBindingInput = z.infer<typeof groupApiRemoveBindingInputSchema>;

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
  bindingIdsToDelete: z.array(z.string()),
  bindingsToCreate: z.array(organizationGroupBindingInputSchema),
  memberUserIdsToAdd: z.array(z.string()),
  memberUserIdsToRemove: z.array(z.string()),
});
export type GroupApiApplyEditsInput = z.infer<typeof groupApiApplyEditsInputSchema>;
