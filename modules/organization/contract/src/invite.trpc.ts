/** Every `invite.*` procedure: the invitations an organization's administrators send. */

import { defineTrpcContract } from "@langwatch/api/contract";

import {
  organizationInviteResentSchema,
  organizationInvitesCreatedSchema,
  organizationListedInvitesSchema,
} from "./organization.responses.ts";
import {
  organizationApiCreateInvitesInputSchema,
  organizationApiInviteScopeSchema,
  organizationApiScopeSchema,
} from "./organization.trpc-schemas.ts";

export const inviteTrpc = defineTrpcContract("invite")
  .mutation("createInvites")
  .withInput(organizationApiCreateInvitesInputSchema)
  .withOutput(organizationInvitesCreatedSchema)

  .mutation("deleteInvite")
  .withInput(organizationApiInviteScopeSchema)

  .mutation("resendInvite")
  .withInput(organizationApiInviteScopeSchema)
  .withOutput(organizationInviteResentSchema)

  .query("getOrganizationPendingInvites")
  .withInput(organizationApiScopeSchema)
  .withOutput(organizationListedInvitesSchema)
  .build();
