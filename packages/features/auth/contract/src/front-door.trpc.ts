/**
 * Every `frontDoor.*` procedure, declared once (D13, ADR-117 §6). The names
 * are the browser's cache keys, so they are the wire names the signed-out
 * screens have always called.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { routingDecisionSchema } from "@langwatch/identity-contract";

import {
  frontDoorAskedSchema,
  frontDoorSentSchema,
  inviteLandingSchema,
  signUpVerificationResultSchema,
} from "./front-door.responses.ts";
import {
  frontDoorEmailInputSchema,
  frontDoorInviteCodeInputSchema,
  frontDoorOwnAddressInputSchema,
  frontDoorRouteInputSchema,
  frontDoorTokenInputSchema,
} from "./front-door.schemas.ts";

export const frontDoorTrpc = defineTrpcContract("frontDoor")
  /**
   * A mutation rather than a query on purpose: a query would be cached and
   * refetched per address, and a per-address cache entry is an
   * account-existence oracle built out of network timing.
   */
  .mutation("route")
  .withInput(frontDoorRouteInputSchema)
  .withOutput(routingDecisionSchema)

  .mutation("requestSignUpVerification")
  .withInput(frontDoorEmailInputSchema)
  .withOutput(frontDoorSentSchema)

  .mutation("completeSignUpVerification")
  .withInput(frontDoorTokenInputSchema)
  .withOutput(signUpVerificationResultSchema)

  .query("inviteLanding")
  .withInput(frontDoorInviteCodeInputSchema)
  .withOutput(inviteLandingSchema)

  .mutation("requestFreshInvite")
  .withInput(frontDoorInviteCodeInputSchema)
  .withOutput(frontDoorAskedSchema)

  .mutation("sendMyAddressConfirmation")
  .withInput(frontDoorOwnAddressInputSchema)
  .withOutput(frontDoorSentSchema)
  .build();
