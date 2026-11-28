/** Every `seatRequest.*` procedure: listing, approving and declining seat requests, a member
 *  asking for a full seat, and the signed-in person's own held memberships. */
import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import { organizationApiScopeSchema } from "../../organization.trpc-schemas.ts";
import {
  completeSeatApprovalInputSchema,
  heldMembershipsSchema,
  myAccessRequestSchema,
  openSeatRequestsSchema,
  requestSeatAccessInputSchema,
  seatApprovalCompletionSchema,
  seatApprovalWithSeatSchema,
  seatRequestResolvedSchema,
  seatRequestScopeSchema,
} from "./seat-request.ts";

export const seatRequestTrpc = defineTrpcContract("seatRequest")
  .query("listOpen")
  .withInput(organizationApiScopeSchema)
  .withOutput(openSeatRequestsSchema)

  .mutation("approve")
  .withInput(seatRequestScopeSchema)
  .withOutput(seatRequestResolvedSchema)

  .mutation("approveWithSeat")
  .withInput(seatRequestScopeSchema)
  .withOutput(seatApprovalWithSeatSchema)

  .mutation("completeSeatApproval")
  .withInput(completeSeatApprovalInputSchema)
  .withOutput(seatApprovalCompletionSchema)

  .mutation("decline")
  .withInput(seatRequestScopeSchema)
  .withOutput(seatRequestResolvedSchema)

  .mutation("requestAccess")
  .withInput(requestSeatAccessInputSchema)
  .withOutput(myAccessRequestSchema)

  .query("myAccessRequest")
  .withInput(organizationApiScopeSchema)
  .withOutput(myAccessRequestSchema)

  .query("myHeldMemberships")
  .withInput(z.object({}))
  .withOutput(heldMembershipsSchema)
  .build();
