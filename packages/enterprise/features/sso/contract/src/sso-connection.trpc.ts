/**
 * Every `ssoConnections.*` procedure, declared once. The back office reads and
 * commands single sign-on connections here, and the browser reads these same
 * schemas as its types. Spec: specs/identity/sso-onboarding-tiers.feature.
 */

import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  activateSsoConnectionInputSchema,
  backofficeSsoConnectionPageSchema,
  backofficeSsoConnectionSchema,
  listSsoConnectionsInputSchema,
  registerSsoConnectionInputSchema,
  rejectSsoDomainClaimInputSchema,
  ssoConnectionByIdSchema,
  ssoConnectionReasonInputSchema,
  ssoConnectionTargetSchema,
  ssoDomainTargetSchema,
} from "./sso.contract.ts";

export const ssoConnectionTrpc = defineTrpcContract("ssoConnections")
  .query("getAll")
  .withInput(listSsoConnectionsInputSchema)
  .withOutput(backofficeSsoConnectionPageSchema)

  .query("getById")
  .withInput(ssoConnectionByIdSchema)
  .withOutput(backofficeSsoConnectionSchema.nullable())

  /**
   * Answers the ledger's own command result, which is the identity aggregate's
   * and not this surface's to describe.
   */
  .mutation("register")
  .withInput(registerSsoConnectionInputSchema)

  .mutation("claimDomain")
  .withInput(ssoDomainTargetSchema)
  .withOutput(z.void())

  .mutation("approveDomainClaim")
  .withInput(ssoDomainTargetSchema)
  .withOutput(z.void())

  .mutation("rejectDomainClaim")
  .withInput(rejectSsoDomainClaimInputSchema)
  .withOutput(z.void())

  .mutation("attestDomain")
  .withInput(ssoDomainTargetSchema)
  .withOutput(z.void())

  .mutation("activate")
  .withInput(activateSsoConnectionInputSchema)
  .withOutput(z.void())

  .mutation("suspend")
  .withInput(ssoConnectionReasonInputSchema)
  .withOutput(z.void())

  .mutation("resume")
  .withInput(ssoConnectionTargetSchema)
  .withOutput(z.void())

  .mutation("requestTeardown")
  .withInput(ssoConnectionReasonInputSchema)
  .withOutput(z.void())
  .build();
