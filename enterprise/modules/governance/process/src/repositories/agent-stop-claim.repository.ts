// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The stop that holds an agent's claim, and when it took it (epoch milliseconds). */
export type AgentStopClaim = { stopId: string; claimedAt: number };

/**
 * Each agent's one open stop, taken before the stop's request is sent (specs/agent-kill-switch.feature).
 * The row is keyed by agent, so two requests at once cannot both take it.
 */
export abstract class AgentStopClaimRepository {
  /** Takes the claim when no stop holds it; false when another request already did. */
  abstract create(input: {
    organizationId: string;
    agentId: string;
    stopId: string;
    claimedAt: number;
  }): Promise<boolean>;
  /** The agent's claim: empty or one. */
  abstract findClaims(input: {
    organizationId: string;
    agentId: string;
  }): Promise<AgentStopClaim[]>;
  /** Hands the claim from `fromStopId` to `toStopId`; false when someone else moved it first. */
  abstract swap(input: {
    organizationId: string;
    agentId: string;
    fromStopId: string;
    toStopId: string;
    claimedAt: number;
  }): Promise<boolean>;
  /** Drops the claim if `stopId` still holds it; a request whose command was never sent. */
  abstract release(input: {
    organizationId: string;
    agentId: string;
    stopId: string;
  }): Promise<void>;
}
