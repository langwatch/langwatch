// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * `ssoSetup.*`: the organization's own administrator, where `ssoConnections.*`
 * is the back office. The names are the page's cache keys, so they are the
 * wire names it has always called.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  ssoConnectionHistoryEntrySchema,
  ssoDomainClaimOutcomeSchema,
  ssoDomainProofSchema,
  ssoDomainProvedSchema,
  ssoHistoryActivitySchema,
  ssoSetupArrivalsSchema,
  ssoSetupConnectionSchema,
  ssoSetupDomainSchema,
  ssoSetupOrganizationSchema,
  ssoSetupPageViewSchema,
  ssoSetupRegisteredSchema,
  ssoSetupRegisterSchema,
  ssoSetupRemovalSchema,
} from "./sso-setup.contract.ts";

export const ssoSetupTrpc = defineTrpcContract("ssoSetup")
  /**
   * Everything the setup page renders, in one read.
   *
   * A query rather than a command that refuses, because an organization that
   * cannot set single sign-on up still has to be TOLD why — the page has to
   * render for the words on it to be readable. `sso:view`, so somebody who
   * may look but not manage still sees where the setup stands.
   */
  .query("getSetup")
  .withInput(ssoSetupOrganizationSchema)
  .withOutput(ssoSetupPageViewSchema)

  /** What happened to this connection, newest first. A read, permanently. */
  .query("getHistory")
  .withInput(ssoSetupConnectionSchema)
  .withOutput(ssoConnectionHistoryEntrySchema.array())

  /** The page's own live signal, gated exactly like the read it refreshes. */
  .subscription("onHistoryActivity")
  .withInput(ssoSetupConnectionSchema)
  .withOutput(ssoHistoryActivitySchema)

  /** Put a domain forward. One somebody else already proved waits for us. */
  .mutation("claimDomain")
  .withInput(ssoSetupDomainSchema)
  .withOutput(ssoDomainClaimOutcomeSchema)

  /** Begins the proof and answers the one-time evidence to publish. */
  .mutation("proveDomain")
  .withInput(ssoSetupDomainSchema)
  .withOutput(ssoDomainProofSchema)

  /** Take a domain back out. Refused for a proved domain on a connection
   *  that is deciding sign-in — the connection is what leaves then. */
  .mutation("removeDomain")
  .withInput(ssoSetupDomainSchema)
  .withOutput(z.void())

  .mutation("checkDomainRecord")
  .withInput(ssoSetupDomainSchema)
  .withOutput(ssoDomainProvedSchema)

  /** The same ceremony's other channel: the well-known file a domain can
   *  serve instead of publishing the record. One token satisfies either. */
  .mutation("checkDomainFile")
  .withInput(ssoSetupDomainSchema)
  .withOutput(ssoDomainProvedSchema)

  /**
   * Register the organization's identity provider, with what it takes to dial
   * it (D09). The credentials go to the vault and the audit row records the
   * attempt without them.
   */
  .mutation("register")
  .withInput(ssoSetupRegisterSchema)
  .withOutput(ssoSetupRegisteredSchema)

  /** Who this connection admits (ADR-117 §3). Going live waits on an answer,
   *  and "turn everybody away" is an answer. */
  .mutation("setArrivals")
  .withInput(ssoSetupArrivalsSchema)
  .withOutput(z.void())

  /** Undo a registration that never went live: the journey opens back on the
   *  register step, and the history keeps what was tried. */
  .mutation("discardConnection")
  .withInput(ssoSetupConnectionSchema)
  .withOutput(z.void())

  /** Take a connection away, on teardown's own terms: scheduled, graced and
   *  reversible until it completes, so no press locks anybody out. */
  .mutation("removeConnection")
  .withInput(ssoSetupRemovalSchema)
  .withOutput(z.void())
  .build();
