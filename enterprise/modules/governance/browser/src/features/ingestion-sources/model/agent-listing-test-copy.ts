// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a source's test connection says, per outcome. A refusal reason is a listing code; each
 * gets one plain sentence that says what to check, and an unknown one falls back to a generic line.
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */
import type { TestAgentListingResult } from "@langwatch/enterprise-governance-contract";

export interface AgentListingTestCopy {
  status: "success" | "info" | "error";
  title: string;
  description?: string;
}

const REFUSAL_DESCRIPTIONS: Record<string, string> = {
  unauthorized:
    "The provider refused the sign-in. Check the key or role and the permissions it holds.",
  not_found:
    "The provider could not find what this source names. Check the projects, regions or address.",
  rate_limited: "The provider is limiting requests right now. Try again in a minute.",
  unavailable: "The provider had an error. Try again in a minute.",
  unreachable: "We could not reach the provider. Check the address, then try again.",
  malformed_response:
    "The provider answered in a format we cannot read. For an ARD registry, check it serves version 0.91.",
  not_configured: "This source is missing its sign-in. Pick a connection or add the key.",
  too_many_pages:
    "The provider has more agents than we read in one pass. Contact support if you need them all.",
  pagination_stalled: "The provider kept sending the same page. Try again later.",
};

const FALLBACK_REFUSAL =
  "The provider would not list its agents. Check the settings, then try again.";

export function agentListingTestCopy(result: TestAgentListingResult): AgentListingTestCopy {
  if (result.outcome === "listed") {
    return {
      status: "success",
      title: `${result.agentCount} ${result.agentCount === 1 ? "agent" : "agents"} found`,
    };
  }
  if (result.outcome === "empty") {
    return {
      status: "info",
      title: "Connected, no agents found",
      description: "The provider answered and holds no agents in what this source names.",
    };
  }
  return {
    status: "error",
    title: "Couldn't list agents",
    description: Object.hasOwn(REFUSAL_DESCRIPTIONS, result.reason)
      ? REFUSAL_DESCRIPTIONS[result.reason]
      : FALLBACK_REFUSAL,
  };
}
