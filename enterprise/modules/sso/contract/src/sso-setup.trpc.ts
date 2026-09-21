// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * `ssoSetup.*`: the organization's own administrator, where `ssoConnections.*`
 * is the back office. The names are the page's cache keys, so they are the
 * wire names it has always called.
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  ssoConnectionHistoryEntrySchema,
  ssoHistoryActivitySchema,
  ssoSetupConnectionSchema,
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
  .build();
