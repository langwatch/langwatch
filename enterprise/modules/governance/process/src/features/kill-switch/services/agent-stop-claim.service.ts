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

/**
 * A claim whose request was never sent and whose stop never reached the projection, or a decision
 * whose command never landed on a stop still pending, is abandoned this long after it was taken.
 */
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
    const released = await this.releaseOf({ organizationId, held, at });
    if (released === "held") {
      throw new AgentStopAlreadyOpenError({ agentId, stopId: held.stopId });
    }
    const swapped = await this.deps.claims.swap({
      ...claim,
      fromStopId: held.stopId,
      toStopId: stopId,
      onlyIfUnsent: released === "abandoned",
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
   * sent. The loser is refused `agent_stop_not_pending`; a failed send gives the decision back and
   * a sent one is marked so. A decision left in flight by a process that died before sending is
   * taken over once abandoned; `at` is the holder's token for the release and the mark.
   */
  async withDecision<T>({
    organizationId,
    stopId,
    status,
    decision,
    at,
    send,
  }: {
    organizationId: string;
    stopId: string;
    status: AgentStopStatus;
    decision: AgentStopClaimDecision;
    at: number;
    send: () => Promise<T>;
  }): Promise<T> {
    const taken = await this.deps.claims.takeDecision({
      organizationId,
      stopId,
      decision,
      takenAt: at,
      abandonedBefore: at - ABANDONED_CLAIM_MS,
    });
    if (!taken) {
      throw new AgentStopNotPendingError({ stopId, status });
    }
    const held = { organizationId, stopId, decision, takenAt: at };
    let sent: T;
    try {
      sent = await send();
    } catch (error) {
      await this.deps.claims.releaseDecision(held);
      throw error;
    }
    await this.deps.claims.markDecisionSent(held);
    return sent;
  }

  /** `closed`: its stop closed. `abandoned`: never sent and too old. `held`: still open. */
  private async releaseOf({
    organizationId,
    held,
    at,
  }: {
    organizationId: string;
    held: AgentStopClaim;
    at: number;
  }): Promise<"closed" | "abandoned" | "held"> {
    try {
      const stop = await this.deps.stops.getStop({ organizationId, stopId: held.stopId });
      return isOpenStatus(stop.status) ? "held" : "closed";
    } catch (error) {
      if (!(error instanceof AgentStopNotFoundError)) throw error;
      return held.sentAt === null && at - held.claimedAt > ABANDONED_CLAIM_MS
        ? "abandoned"
        : "held";
    }
  }
}
