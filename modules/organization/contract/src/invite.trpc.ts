/** Every `invite.*` procedure: the invitations administrators send, and accepting one. */

import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import {
  INVITE_ACCEPTED_EVENT_TYPE,
  MEMBERS_INVITED_EVENT_TYPE,
} from "./organization-lifecycle.events.ts";
import {
  organizationInviteAcceptedSchema,
  organizationInviteResentSchema,
  organizationInvitesCreatedSchema,
  organizationListedInvitesSchema,
  organizationPendingInvitationForCallerSchema,
  organizationPendingInvitationsForCallerSchema,
} from "./organization.responses.ts";
import {
  organizationApiAcceptInviteInputSchema,
  organizationApiCreateInvitesInputSchema,
  organizationApiInviteScopeSchema,
  organizationApiMemberRoleSchema,
  organizationApiScopeSchema,
  organizationApiSeatCheckoutInputSchema,
  organizationSeatCheckoutRedirectSchema,
} from "./organization.trpc-schemas.ts";

/** The most invitations one seat check takes; a members page invites a handful at a time. */
const MAX_CHECKED_INVITES = 50;

export const inviteTrpc = defineTrpcContract("invite")
  .mutation("createInvites")
  .withInput(organizationApiCreateInvitesInputSchema)
  .withOutput(organizationInvitesCreatedSchema)

  .mutation("deleteInvite")
  .withInput(organizationApiInviteScopeSchema)

  /** Refuses, writing nothing, invitations a seat is about to be bought for. */
  .mutation("checkInvites")
  .withInput(
    z.object({
      organizationId: z.string().min(1),
      invites: z
        .array(
          z.object({
            email: z.string().email(),
            role: organizationApiMemberRoleSchema,
          }),
        )
        .min(1)
        .max(MAX_CHECKED_INVITES),
    }),
  )

  .mutation("resendInvite")
  .withInput(organizationApiInviteScopeSchema)
  .withOutput(organizationInviteResentSchema)

  .query("getOrganizationPendingInvites", {
    invalidatedBy: [
      { event: MEMBERS_INVITED_EVENT_TYPE, scope: "organizationId" },
      { event: INVITE_ACCEPTED_EVENT_TYPE, scope: "organizationId" },
    ],
  })
  .withInput(organizationApiScopeSchema)
  .withOutput(organizationListedInvitesSchema)

  .mutation("acceptInvite")
  .withInput(organizationApiAcceptInviteInputSchema)
  .withOutput(organizationInviteAcceptedSchema)

  .mutation("upgradeWithInvites")
  .withInput(organizationApiSeatCheckoutInputSchema)
  .withOutput(organizationSeatCheckoutRedirectSchema)

  .query("myPendingInvitation")
  .withInput(z.object({}))
  .withOutput(organizationPendingInvitationForCallerSchema)

  /** The invitations waiting on the caller's own VERIFIED addresses (ADR-171 v6). */
  .query("pendingForMe")
  .withInput(z.object({}))
  .withOutput(organizationPendingInvitationsForCallerSchema)
  .build();
