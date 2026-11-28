/**
 * The server half of `seatRequest.*`: approving needs the seat request permission; asking needs
 * only a membership (members:view, which every organization role holds); the waiting screen none.
 */

import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { OrganizationApi, seatRequestTrpc } from "@langwatch/organization-contract";

import {
  BEFORE_MEMBERSHIP,
  callerOf,
  organizationSessionPersonContext,
} from "./organization.trpc.ts";

export const seatRequestTrpcTransport: TrpcRouterDeclaration<
  OrganizationApi,
  typeof seatRequestTrpc
> = defineTrpcRouter(OrganizationApi, seatRequestTrpc)
  .procedure("listOpen")
  .withPermission("seatRequests:view")
  .handle(({ app, input }) => app.listOpenSeatRequests({ organizationId: input.organizationId }))

  .procedure("approve")
  .withMiddlewareContext(organizationSessionPersonContext)
  .withPermission("seatRequests:manage")
  .handle(({ app, input, actor }, person) => app.approveSeatRequest(input, callerOf(actor, person)))

  /** Charges a seat and approves, so it needs both to answer seat requests and the plan. */
  .procedure("approveWithSeat")
  .withMiddlewareContext(organizationSessionPersonContext)
  .withPermission(["seatRequests:manage", "subscription:manage"])
  .handle(({ app, input, actor }, person) =>
    app.approveSeatRequestWithSeat(input, callerOf(actor, person)),
  )

  .procedure("completeSeatApproval")
  .withMiddlewareContext(organizationSessionPersonContext)
  .withPermission(["seatRequests:manage", "subscription:manage"])
  .handle(({ app, input, actor }, person) =>
    app.completeSeatApproval(input, callerOf(actor, person)),
  )

  .procedure("decline")
  .withMiddlewareContext(organizationSessionPersonContext)
  .withPermission("seatRequests:manage")
  .handle(({ app, input, actor }, person) => app.declineSeatRequest(input, callerOf(actor, person)))

  .procedure("requestAccess")
  .withMiddlewareContext(organizationSessionPersonContext)
  .withPermission("members:view")
  .handle(({ app, input, actor }, person) => app.requestSeatAccess(input, callerOf(actor, person)))

  .procedure("myAccessRequest")
  .withMiddlewareContext(organizationSessionPersonContext)
  .withPermission("members:view")
  .handle(({ app, input, actor }, person) =>
    app.getMyAccessRequest({ organizationId: input.organizationId }, callerOf(actor, person)),
  )

  /** The session person's own held rows: they have no working membership, which is the point. */
  .procedure("myHeldMemberships")
  .withMiddlewareContext(organizationSessionPersonContext)
  .noPermission(BEFORE_MEMBERSHIP)
  .handle(({ app, actor }, person) => app.getHeldMemberships(callerOf(actor, person)))
  .build();
