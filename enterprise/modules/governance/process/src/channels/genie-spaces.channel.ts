// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AgentListing } from "../rules/agent-listing.rules.ts";

/** Asking a Databricks workspace which Genie spaces one credential can see. Never throws. */
export interface GenieSpacesChannel {
  listAgents(args: {
    workspaceUrl: string;
    token: string;
    signal?: AbortSignal;
  }): Promise<AgentListing>;
}
