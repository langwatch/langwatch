/** Every `seatRequest.*` procedure: listing, approving and declining seat requests, and the
 *  signed-in person's own held memberships. */
import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import { organizationApiScopeSchema } from "../../organization.trpc-schemas.ts";
import {
  heldMembershipsSchema,
  openSeatRequestsSchema,
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

  .mutation("decline")
  .withInput(seatRequestScopeSchema)
  .withOutput(seatRequestResolvedSchema)

  .query("myHeldMemberships")
  .withInput(z.object({}))
  .withOutput(heldMembershipsSchema)
  .build();
