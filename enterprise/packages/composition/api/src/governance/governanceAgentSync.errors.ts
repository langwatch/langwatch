// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What an on-demand agent listing refuses to start, said in words the admin
 * can act on.
 *
 * Distinct from a provider refusing to answer. Nothing here has reached a
 * provider: the request could not be recorded at all, so there is no outcome
 * coming later and telling the reader to wait for one would be wrong.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */

import { HandledError } from "@langwatch/handled-error";

/**
 * The deployment cannot run listings.
 *
 * Either event sourcing is off in this deployment or the organization has no
 * governance project for the request to be tenanted to. Both are deployment
 * facts rather than anything the reader did, and neither leaves a request in
 * flight, so they share one sentence: the reader's next move is the same
 * either way. `reason` rides in meta for the log.
 *
 * `fault` is platform deliberately. An admin pressing a button on a page the
 * platform rendered for them has done nothing wrong, and no provider was
 * reached, so neither of the other two faults fits.
 */
export class AgentListingUnavailableError extends HandledError {
  declare readonly code: "agent_listing_unavailable";

  constructor(reason: "event_sourcing_disabled" | "no_governance_project") {
    super("agent_listing_unavailable", "Agent sync isn't available here", {
      httpStatus: 503,
      fault: "platform",
      meta: { reason },
    });
    this.name = "AgentListingUnavailableError";
  }
}
