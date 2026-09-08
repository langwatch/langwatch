/**
 * Every `roleBinding.*` procedure, declared once: who holds a role, and where.
 * Every read is audit-grade authorization data, so the whole surface sits at
 * `organization:manage` apart from the caller's own breakdown.
 */
import {
  authzAccessBreakdownOutputSchema,
  authzBindingMutationSuccessSchema,
  authzCreateBindingOutputSchema,
  authzListManagedBindingsForOrganizationOutputSchema,
  authzListManagedBindingsForUserOutputSchema,
} from "@langwatch/authz-contract";
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  roleBindingApiApplyMemberBindingsInputSchema,
  roleBindingApiBindingInputSchema,
  roleBindingApiCreateInputSchema,
  roleBindingApiOrganizationInputSchema,
  roleBindingApiUpdateInputSchema,
  roleBindingApiUserInputSchema,
} from "./role-binding.schemas.ts";

export const roleBindingTrpc = defineTrpcContract("roleBinding")
  .query("listForOrg")
  .withInput(roleBindingApiOrganizationInputSchema)
  .withOutput(authzListManagedBindingsForOrganizationOutputSchema)

  .query("listForUser")
  .withInput(roleBindingApiUserInputSchema)
  .withOutput(authzListManagedBindingsForUserOutputSchema)

  .query("getMyAccessBreakdown")
  .withInput(roleBindingApiOrganizationInputSchema)
  .withOutput(authzAccessBreakdownOutputSchema)

  .mutation("create")
  .withInput(roleBindingApiCreateInputSchema)
  .withOutput(authzCreateBindingOutputSchema)

  .mutation("update")
  .withInput(roleBindingApiUpdateInputSchema)
  .withOutput(authzCreateBindingOutputSchema)

  .mutation("delete")
  .withInput(roleBindingApiBindingInputSchema)
  .withOutput(authzBindingMutationSuccessSchema)

  .mutation("applyMemberBindings")
  .withInput(roleBindingApiApplyMemberBindingsInputSchema)
  .withOutput(authzBindingMutationSuccessSchema)
  .build();
