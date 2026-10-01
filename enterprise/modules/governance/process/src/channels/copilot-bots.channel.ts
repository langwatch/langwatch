// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { AgentListing, AgentListingRefusal } from "../rules/agent-listing.rules.ts";

/**
 * The `bot` table read, answering which of three things happened. `hasMorePages`
 * is apart from the rows because a caller cannot tell a short list from a whole one.
 */
export type CopilotBotsRead =
  | { ok: true; rows: unknown[]; hasMorePages: boolean }
  | { ok: false; refusal: AgentListingRefusal };

/** Asking a Power Platform environment which Copilot Studio agents it holds. Never throws. */
export interface CopilotBotsChannel {
  readBots(args: {
    environmentUrl: string;
    token: string;
    signal?: AbortSignal;
    /** Walk `@odata.nextLink` to the end instead of reading one page. */
    shouldFollowPages?: boolean;
  }): Promise<CopilotBotsRead>;
  listAgents(args: {
    environmentUrl: string;
    token: string;
    signal?: AbortSignal;
  }): Promise<AgentListing>;
}
