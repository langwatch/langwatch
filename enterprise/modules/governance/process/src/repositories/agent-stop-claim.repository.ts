// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The stop that holds an agent's claim, when it took it and when its request was sent (epoch
 * milliseconds; null until then).
 */
export type AgentStopClaim = { stopId: string; claimedAt: number; sentAt: number | null };

/** The one decision a pending stop takes. */
export type AgentStopClaimDecision = "approve" | "deny";

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
  /** Marks the request of `stopId` sent; from then on its claim never passes on by age. */
  abstract markSent(input: {
    organizationId: string;
    agentId: string;
    stopId: string;
    sentAt: number;
  }): Promise<void>;
  /** Takes the stop's one decision; false when another approve or deny took it first. */
  abstract takeDecision(input: {
    organizationId: string;
    stopId: string;
    decision: AgentStopClaimDecision;
  }): Promise<boolean>;
  /** Gives the decision back when its command was never sent. */
  abstract releaseDecision(input: {
    organizationId: string;
    stopId: string;
    decision: AgentStopClaimDecision;
  }): Promise<void>;
  /** Hands the claim from `fromStopId` to `toStopId`, unsent and undecided; false when moved first. */
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
