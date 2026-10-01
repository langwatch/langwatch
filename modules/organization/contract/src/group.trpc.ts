/**
 * Every `group.*` procedure, declared once. A group is an access grant, so the
 * whole namespace sits behind `organization:manage`; groups arrive with SCIM,
 * so listing and creating one also ask the Enterprise plan.
 */

import { defineTrpcContract } from "@langwatch/kernel/contract";

import {
  groupGrantCreatedSchema,
  groupDetailSchema,
  groupListItemSchema,
  groupMembershipViewSchema,
  groupWriteAckSchema,
} from "./group.responses.ts";
import {
  groupApiAddGrantInputSchema,
  groupApiApplyEditsInputSchema,
  groupApiCreateInputSchema,
  groupApiGroupScopeSchema,
  groupApiMemberInputSchema,
  groupApiMemberScopeSchema,
  groupApiRemoveGrantInputSchema,
  groupApiRenameInputSchema,
} from "./group.trpc-schemas.ts";
import { organizationGroupSchema } from "./group.ts";
import { organizationApiScopeSchema } from "./organization.trpc-schemas.ts";

export const groupTrpc = defineTrpcContract("group")
  .query("listAll")
  .withInput(organizationApiScopeSchema)
  .withOutput(groupListItemSchema.array())

  .query("getById")
  .withInput(groupApiGroupScopeSchema)
  .withOutput(groupDetailSchema)

  .mutation("create")
  .withInput(groupApiCreateInputSchema)
  .withOutput(organizationGroupSchema)

  .mutation("addGrant")
  .withInput(groupApiAddGrantInputSchema)
  .withOutput(groupGrantCreatedSchema)

  .mutation("removeGrant")
  .withInput(groupApiRemoveGrantInputSchema)
  .withOutput(groupWriteAckSchema)

  .mutation("addMember")
  .withInput(groupApiMemberInputSchema)
  .withOutput(groupWriteAckSchema)

  .mutation("delete")
  .withInput(groupApiGroupScopeSchema)
  .withOutput(groupWriteAckSchema)

  .mutation("rename")
  .withInput(groupApiRenameInputSchema)
  .withOutput(organizationGroupSchema)

  /** Which groups one person is in, as the member drawer renders them. */
  .query("listForMember")
  .withInput(groupApiMemberScopeSchema)
  .withOutput(groupMembershipViewSchema.array())

  .mutation("removeMember")
  .withInput(groupApiMemberInputSchema)
  .withOutput(groupWriteAckSchema)

  .mutation("applyEdits")
  .withInput(groupApiApplyEditsInputSchema)
  .withOutput(groupWriteAckSchema)
  .build();
