/**
 * The server half of `seatRequest.*`: approving needs the seat request permission; the waiting
 * screen needs none.
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

  .procedure("decline")
  .withMiddlewareContext(organizationSessionPersonContext)
  .withPermission("seatRequests:manage")
  .handle(({ app, input, actor }, person) => app.declineSeatRequest(input, callerOf(actor, person)))

  /** The session person's own held rows: they have no working membership, which is the point. */
  .procedure("myHeldMemberships")
  .withMiddlewareContext(organizationSessionPersonContext)
  .noPermission(BEFORE_MEMBERSHIP)
  .handle(({ app, actor }, person) => app.getHeldMemberships(callerOf(actor, person)))
  .build();
