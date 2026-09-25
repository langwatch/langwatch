/** Every `invite.*` procedure: the invitations administrators send, and accepting one. */

import { defineTrpcContract } from "@langwatch/api/contract";

import {
  organizationInviteAcceptedSchema,
  organizationInviteResentSchema,
  organizationInvitesCreatedSchema,
  organizationListedInvitesSchema,
} from "./organization.responses.ts";
import {
  organizationApiAcceptInviteInputSchema,
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

  .mutation("acceptInvite")
  .withInput(organizationApiAcceptInviteInputSchema)
  .withOutput(organizationInviteAcceptedSchema)
  .build();
