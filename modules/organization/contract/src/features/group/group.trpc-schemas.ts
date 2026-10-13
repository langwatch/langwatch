import type { Named } from "@langwatch/module";
import { z } from "zod";

import { organizationGroupGrantInputSchema } from "./group.ts";

/**
 * The transport inputs the group surface publishes; every call also carries
 * `organizationApiScopeSchema` from `organization.api.ts`.
 */

export const groupApiNameSchema = z.string().trim().min(1, "Group name is required").max(100);

const groupApiGroupScopeSchemaDefinition = z.object({
  organizationId: z.string(),
  groupId: z.string(),
});
export interface GroupApiGroupScopeSchema extends Named<
  typeof groupApiGroupScopeSchemaDefinition
> {}
export const groupApiGroupScopeSchema: GroupApiGroupScopeSchema =
  groupApiGroupScopeSchemaDefinition;
export type GroupApiGroupScope = z.infer<typeof groupApiGroupScopeSchema>;

const groupApiCreateInputSchemaDefinition = z.object({
  organizationId: z.string(),
  name: groupApiNameSchema,
  grants: z.array(organizationGroupGrantInputSchema).optional(),
  memberIds: z.array(z.string()).optional(),
});
export interface GroupApiCreateInputSchema extends Named<
  typeof groupApiCreateInputSchemaDefinition
> {}
export const groupApiCreateInputSchema: GroupApiCreateInputSchema =
  groupApiCreateInputSchemaDefinition;
export type GroupApiCreateInput = z.infer<typeof groupApiCreateInputSchema>;

const groupApiAddGrantInputSchemaDefinition = z.object({
  organizationId: z.string(),
  groupId: z.string(),
  ...organizationGroupGrantInputSchema.shape,
});
export interface GroupApiAddGrantInputSchema extends Named<
  typeof groupApiAddGrantInputSchemaDefinition
> {}
export const groupApiAddGrantInputSchema: GroupApiAddGrantInputSchema =
  groupApiAddGrantInputSchemaDefinition;
export type GroupApiAddGrantInput = z.infer<typeof groupApiAddGrantInputSchema>;

const groupApiRemoveGrantInputSchemaDefinition = z.object({
  organizationId: z.string(),
  grantId: z.string(),
});
export interface GroupApiRemoveGrantInputSchema extends Named<
  typeof groupApiRemoveGrantInputSchemaDefinition
> {}
export const groupApiRemoveGrantInputSchema: GroupApiRemoveGrantInputSchema =
  groupApiRemoveGrantInputSchemaDefinition;
export type GroupApiRemoveGrantInput = z.infer<typeof groupApiRemoveGrantInputSchema>;

const groupApiMemberInputSchemaDefinition = z.object({
  organizationId: z.string(),
  groupId: z.string(),
  userId: z.string(),
});
export interface GroupApiMemberInputSchema extends Named<
  typeof groupApiMemberInputSchemaDefinition
> {}
export const groupApiMemberInputSchema: GroupApiMemberInputSchema =
  groupApiMemberInputSchemaDefinition;
export type GroupApiMemberInput = z.infer<typeof groupApiMemberInputSchema>;

const groupApiRenameInputSchemaDefinition = z.object({
  organizationId: z.string(),
  groupId: z.string(),
  name: groupApiNameSchema,
});
export interface GroupApiRenameInputSchema extends Named<
  typeof groupApiRenameInputSchemaDefinition
> {}
export const groupApiRenameInputSchema: GroupApiRenameInputSchema =
  groupApiRenameInputSchemaDefinition;
export type GroupApiRenameInput = z.infer<typeof groupApiRenameInputSchema>;

/** One member of one organization, for the groups-they-are-in read. */
const groupApiMemberScopeSchemaDefinition = z.object({
  organizationId: z.string(),
  userId: z.string(),
});
export interface GroupApiMemberScopeSchema extends Named<
  typeof groupApiMemberScopeSchemaDefinition
> {}
export const groupApiMemberScopeSchema: GroupApiMemberScopeSchema =
  groupApiMemberScopeSchemaDefinition;
export type GroupApiMemberScope = z.infer<typeof groupApiMemberScopeSchema>;

const groupApiApplyEditsInputSchemaDefinition = z.object({
  organizationId: z.string(),
  groupId: z.string(),
  rename: z.object({ name: groupApiNameSchema }).nullable().optional(),
  grantIdsToRevoke: z.array(z.string()),
  grantsToCreate: z.array(organizationGroupGrantInputSchema),
  memberUserIdsToAdd: z.array(z.string()),
  memberUserIdsToRemove: z.array(z.string()),
});
export interface GroupApiApplyEditsInputSchema extends Named<
  typeof groupApiApplyEditsInputSchemaDefinition
> {}
export const groupApiApplyEditsInputSchema: GroupApiApplyEditsInputSchema =
  groupApiApplyEditsInputSchemaDefinition;
export type GroupApiApplyEditsInput = z.infer<typeof groupApiApplyEditsInputSchema>;

const groupGrantRoleSchema = z.object({
  role: z.string().optional(),
  customRoleId: z.string().nullish(),
});

/** Every place a group write names a grant: a new group, one grant, a batch of edits. */
const groupGrantsSchema = z.object({
  ...groupGrantRoleSchema.shape,
  grants: z.array(groupGrantRoleSchema).optional(),
  grantsToCreate: z.array(groupGrantRoleSchema).optional(),
});

/** Whether a group write grants a custom role: the question only Enterprise answers yes to. */
export function assignsGroupCustomRole(input: unknown): boolean {
  const parsed = groupGrantsSchema.safeParse(input);
  if (!parsed.success) return false;

  const { grants = [], grantsToCreate = [], ...single } = parsed.data;

  return [single, ...grants, ...grantsToCreate].some(
    (grant) => Boolean(grant.customRoleId) || grant.role === "CUSTOM",
  );
}
