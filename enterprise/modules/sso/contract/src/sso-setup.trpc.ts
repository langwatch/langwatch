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
  ssoSetupConnectionSchema,
  ssoSetupDomainSchema,
} from "./sso-setup.contract.ts";

export const ssoSetupTrpc = defineTrpcContract("ssoSetup")
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
  .build();
