/** The server half of `invite.*`: every procedure is an administrator's. */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { inviteTrpc, OrganizationApi } from "@langwatch/organization-contract";

import { callerOf, organizationSessionPersonFact } from "./organization.trpc.ts";

export const inviteTrpcTransport = defineTrpcRouter(OrganizationApi, inviteTrpc)
  /**
   * Lenient, as the invite form has always done: an ungrantable team
   * assignment is dropped and the rest are still created, rather than losing
   * a hand-typed batch. `organization-management.rest.ts` asks for `strict`.
   */
  .procedure("createInvites")
  .withFacts(organizationSessionPersonFact)
  .withPermission("organization:manage")
  .handle(({ app, input, actor }, person) =>
    app.createInvitations({ ...input, validation: "lenient" }, callerOf(actor, person)),
  )

  .procedure("deleteInvite")
  .withPermission("organization:manage")
  .handle(async ({ app, input }) => {
    await app.revokeInvitation(input);
  })

  .procedure("resendInvite")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.resendInvitation(input))

  /**
   * Pending invitations expose admin intent - who is being added, with what
   * role, to which teams - so this is a manage read rather than a view one.
   */
  .procedure("getOrganizationPendingInvites")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.listPendingInvitations(input))
  .build();
