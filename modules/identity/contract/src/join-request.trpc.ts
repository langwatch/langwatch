/**
 * Every `identity.joinRequests.*` procedure, declared once; asking to join runs
 * partly outside membership since the caller isn't a member yet. `lookup`
 * answers identity's join-matching decision.
 */

import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import type { JoinLookupDecision } from "./join-matching.ts";
import {
  identityDomainAdmissionSchema,
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
  joinRequestApiAdmissionsInputSchema,
  joinRequestApiAdmitInputSchema,
  joinRequestApiDecisionInputSchema,
  joinRequestApiOrganizationScopeSchema,
  joinRequestApiRequestInputSchema,
  joinRequestApiSetJoiningInputSchema,
  joinRequestApiWithdrawInputSchema,
} from "./join-request.trpc-schemas.ts";

/** The join-matching decision, forwarded untouched: typed for the browser, never re-validated. */
export const joinRequestLookupSchema = z.custom<JoinLookupDecision>();

export const joinRequestTrpc = defineTrpcContract("identity.joinRequests")
  /**
   * Which organizations are open to the caller's own verified addresses. Every
   * closed door - unverified, consumer domain, joining off, nonexistent - is
   * the same answer.
   */
  .query("lookup")
  .withInput(z.void())
  .withOutput(joinRequestLookupSchema)

  /** The same answer for somebody already signed in, minus the domains they dismissed. */
  .query("offer")
  .withInput(z.void())
  .withOutput(joinRequestLookupSchema)

  /** "No thanks", remembered for the caller's own verified domain. */
  .mutation("dismissOffer")
  .withInput(z.object({}))
  .withOutput(joinRequestWriteAckSchema)

  /** Walk in, where the organization asked for that; null organization when nothing admits. */
  .mutation("admitAutomatically")
  .withInput(joinRequestApiAdmitInputSchema)
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

  /** Which of these members a matching domain admitted, for member provenance. */
  .query("getJoinAdmissions")
  .withInput(joinRequestApiAdmissionsInputSchema)
  .withOutput(z.array(identityDomainAdmissionSchema))
  .build();
