// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  AgentStopAlreadyOpenError,
  AgentStopNotFoundError,
  AgentStopNotPendingError,
  type AgentStopStatus,
} from "@langwatch/enterprise-governance-contract";

import type {
  AgentStopClaim,
  AgentStopClaimDecision,
  AgentStopClaimRepository,
} from "../../../repositories/agent-stop-claim.repository.ts";
import type { AgentStopRepository } from "../../../repositories/agent-stop.repository.ts";
import { isOpenStatus } from "../rules/agent-stop.rules.ts";

/** A claim whose request was never sent and whose stop never reached the projection is abandoned this long after. */
export const ABANDONED_CLAIM_MS = 15 * 60 * 1000;

interface AgentStopClaimDependencies {
  claims: AgentStopClaimRepository;
  stops: Pick<AgentStopRepository, "getStop">;
}

/**
 * Each agent's one open stop and each pending stop's one decision. A claim passes to a new stop
 * only once the stop holding it has closed, or when its request was never sent and its stop never
 * reached the projection. Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
export class AgentStopClaimService {
  private constructor(private readonly deps: AgentStopClaimDependencies) {}

  static create(deps: AgentStopClaimDependencies): AgentStopClaimService {
    return new AgentStopClaimService(deps);
  }

  /** Takes the agent's claim for `stopId`, or refuses `agent_stop_already_open`. */
  async claim({
    organizationId,
    agentId,
    stopId,
    at,
  }: {
    organizationId: string;
    agentId: string;
    stopId: string;
    at: number;
  }): Promise<void> {
    const claim = { organizationId, agentId, claimedAt: at };
    if (await this.deps.claims.create({ ...claim, stopId })) return;
    const [held] = await this.deps.claims.findClaims({ organizationId, agentId });
    if (!held) {
      if (await this.deps.claims.create({ ...claim, stopId })) return;
      throw new AgentStopAlreadyOpenError({ agentId, stopId: "unknown" });
    }
    if (!(await this.isReleased({ organizationId, held, at }))) {
      throw new AgentStopAlreadyOpenError({ agentId, stopId: held.stopId });
    }
    const swapped = await this.deps.claims.swap({
      ...claim,
      fromStopId: held.stopId,
      toStopId: stopId,
    });
    if (!swapped) throw new AgentStopAlreadyOpenError({ agentId, stopId: held.stopId });
  }

  markSent(input: {
    organizationId: string;
    agentId: string;
    stopId: string;
    sentAt: number;
  }): Promise<void> {
    return this.deps.claims.markSent(input);
  }

  release(input: { organizationId: string; agentId: string; stopId: string }): Promise<void> {
    return this.deps.claims.release(input);
  }

  /**
   * Runs `send` holding the stop's one decision, so a concurrent approve and deny cannot both be
   * sent. The loser is refused `agent_stop_not_pending`; a failed send gives the decision back.
   */
  async withDecision<T>({
    organizationId,
    stopId,
    status,
    decision,
    send,
  }: {
    organizationId: string;
    stopId: string;
    status: AgentStopStatus;
    decision: AgentStopClaimDecision;
    send: () => Promise<T>;
  }): Promise<T> {
    if (!(await this.deps.claims.takeDecision({ organizationId, stopId, decision }))) {
      throw new AgentStopNotPendingError({ stopId, status });
    }
    try {
      return await send();
    } catch (error) {
      await this.deps.claims.releaseDecision({ organizationId, stopId, decision });
      throw error;
    }
  }

  private async isReleased({
    organizationId,
    held,
    at,
  }: {
    organizationId: string;
    held: AgentStopClaim;
    at: number;
  }): Promise<boolean> {
    try {
      const stop = await this.deps.stops.getStop({ organizationId, stopId: held.stopId });
      return !isOpenStatus(stop.status);
    } catch (error) {
      if (!(error instanceof AgentStopNotFoundError)) throw error;
      return held.sentAt === null && at - held.claimedAt > ABANDONED_CLAIM_MS;
    }
  }
}
