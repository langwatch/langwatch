/**
 * Every `joinRequests.*` procedure, declared once; asking to join runs partly
 * outside membership since the caller isn't a member yet. `lookup` answers
 * the identity feature's own join-matching decision, unread here.
 */

import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  joinRequestAdmittedSchema,
  joinRequestAutomaticJoinsSchema,
  joinRequestFiledSchema,
  joinRequestJoiningChangedSchema,
  joinRequestJoiningSchema,
  joinRequestMineSchema,
  joinRequestPendingSchema,
  joinRequestWriteAckSchema,
} from "./join-request.responses.ts";
import {
  joinRequestApiDecisionInputSchema,
  joinRequestApiOrganizationScopeSchema,
  joinRequestApiRequestInputSchema,
  joinRequestApiWithdrawInputSchema,
} from "./join-request.trpc-schemas.ts";

/**
 * How colleagues on a matching domain get in. The three settings are the
 * identity feature's vocabulary, restated here so the contract carries no
 * value import from it.
 */
export const joinRequestApiDomainJoinSchema = z.enum(["off", "request", "auto"]);
export type JoinRequestApiDomainJoin = z.infer<typeof joinRequestApiDomainJoinSchema>;

export const joinRequestApiSetJoiningInputSchema = z.object({
  organizationId: z.string().min(1),
  domainJoin: joinRequestApiDomainJoinSchema,
  domains: z.array(z.string().min(1)).default([]),
});
export type JoinRequestApiSetJoiningInput = z.infer<typeof joinRequestApiSetJoiningInputSchema>;

/** The identity feature's join-matching decision, forwarded untouched. */
export const joinRequestLookupSchema = z.unknown();

export const joinRequestTrpc = defineTrpcContract("joinRequests")
  /**
   * Which organizations are open to the caller's own verified addresses. Every
   * closed door - unverified, consumer domain, joining off, nonexistent - is
   * the same answer.
   */
  .query("lookup")
  .withInput(z.void())
  .withOutput(joinRequestLookupSchema)

  /**
   * The same answer for somebody already signed in with an organization — the
   * post-login offer — minus the domains they have dismissed.
   */
  .query("offer")
  .withInput(z.void())
  .withOutput(joinRequestLookupSchema)

  /** "No thanks", remembered for the caller's own verified domain. */
  .mutation("dismissOffer")
  .withInput(z.object({}))
  .withOutput(joinRequestWriteAckSchema)

  /** Walk in, where the organization asked for that; null organization when nothing admits. */
  .mutation("admitAutomatically")
  .withInput(z.object({}))
  .withOutput(joinRequestAdmittedSchema)

  /** Everything this person is waiting on, so a screen can say so. */
  .query("mine")
  .withInput(z.void())
  .withOutput(joinRequestMineSchema)

  .mutation("request")
  .withInput(joinRequestApiRequestInputSchema)
  .withOutput(joinRequestFiledSchema)

  .mutation("withdraw")
  .withInput(joinRequestApiWithdrawInputSchema)
  .withOutput(joinRequestWriteAckSchema)

  /** What is waiting on this organization, for the members area. */
  .query("pending")
  .withInput(joinRequestApiOrganizationScopeSchema)
  .withOutput(joinRequestPendingSchema)

  .mutation("approve")
  .withInput(joinRequestApiDecisionInputSchema)
  .withOutput(joinRequestWriteAckSchema)

  .mutation("reject")
  .withInput(joinRequestApiDecisionInputSchema)
  .withOutput(joinRequestWriteAckSchema)

  .query("joining")
  .withInput(joinRequestApiOrganizationScopeSchema)
  .withOutput(joinRequestJoiningSchema)

  .mutation("setJoining")
  .withInput(joinRequestApiSetJoiningInputSchema)
  .withOutput(joinRequestJoiningChangedSchema)

  /** Who walked in without anybody approving, lately, for the members area. */
  .query("automaticJoins")
  .withInput(joinRequestApiOrganizationScopeSchema)
  .withOutput(joinRequestAutomaticJoinsSchema)
  .build();
