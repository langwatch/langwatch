/**
 * The server half of `joinRequests.*`. Half of it runs outside membership:
 * asking to join is the one action somebody takes on an organization they are
 * not in yet, so those handlers prove standing themselves and reveal nothing
 * about an organization that did not offer itself to the caller.
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { joinRequestTrpc, OrganizationApi } from "@langwatch/organization-contract";

const NOT_A_MEMBER_YET = {
  reason:
    "the caller is asking about organizations they are not in yet, so there is no scope to hold a permission on; the handler answers only for the session's OWN verified addresses and reveals nothing else",
} as const;

const OWN_PENDING_REQUESTS = {
  reason: "the caller's own pending requests, keyed by their session id",
} as const;

const OFFERED_ORGANIZATION_ONLY = {
  reason:
    "asking to join is the one action a non-member takes on an organization; the handler proves the organization was OFFERED to this caller's verified domain and refuses anything else as if it did not exist",
  allow: { organizationId: "the organization the matcher offered" },
} as const;

const OWN_REQUEST_ONLY = {
  // No `allow` map: `joinRequestId` is not a scope id, and the handler refuses
  // a request that is not the caller's as if it did not exist.
  reason: "the requester withdrawing their own request, matched on the session's user id",
} as const;

export const joinRequestTrpcTransport = defineTrpcRouter(OrganizationApi, joinRequestTrpc)
  .procedure("lookup")
  .noPermission(NOT_A_MEMBER_YET)
  .handle(({ app, actor }) => app.lookupJoinableOrganizations({ userId: actor.id }))

  .procedure("mine")
  .noPermission(OWN_PENDING_REQUESTS)
  .handle(({ app, actor }) => app.listOwnJoinRequests({ userId: actor.id }))

  .procedure("request")
  .noPermission(OFFERED_ORGANIZATION_ONLY)
  .handle(({ app, input, actor }) =>
    app.fileJoinRequest({ userId: actor.id, organizationId: input.organizationId }),
  )

  .procedure("withdraw")
  .noPermission(OWN_REQUEST_ONLY)
  .handle(async ({ app, input, actor }) => {
    await app.withdrawJoinRequest({ joinRequestId: input.joinRequestId, userId: actor.id });

    return { success: true as const };
  })

  /** What is waiting on this organization, for the members area. */
  .procedure("pending")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.listPendingJoinRequests({ organizationId: input.organizationId }))

  /**
   * Approve: no role on this input, ever. It grants the default role; more
   * goes through a formal invitation instead.
   */
  .procedure("approve")
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }) => {
    await app.approveJoinRequest({
      joinRequestId: input.joinRequestId,
      organizationId: input.organizationId,
      adminUserId: actor.id,
    });

    return { success: true as const };
  })

  /**
   * Reject. No reason field: an admin who has to justify a refusal is an admin
   * who hesitates to make one.
   */
  .procedure("reject")
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }) => {
    await app.rejectJoinRequest({
      joinRequestId: input.joinRequestId,
      organizationId: input.organizationId,
      adminUserId: actor.id,
    });

    return { success: true as const };
  })

  /**
   * How colleagues on a matching domain currently get in. Behind
   * `organization:manage` like the write: an organization's joining posture is
   * not a stranger's business.
   */
  .procedure("joining")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.readJoiningPolicy({ organizationId: input.organizationId }))

  .procedure("setJoining")
  .withPermission("organization:manage")
  .handle(({ app, input }) =>
    app.setJoiningPolicy({
      organizationId: input.organizationId,
      domainJoin: input.domainJoin,
      domains: input.domains,
    }),
  )
  .build();
