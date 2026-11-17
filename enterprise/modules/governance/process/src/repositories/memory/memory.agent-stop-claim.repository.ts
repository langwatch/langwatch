// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type AgentStopClaim,
  type AgentStopClaimDecision,
  AgentStopClaimRepository,
} from "../agent-stop-claim.repository.ts";

type HeldClaim = AgentStopClaim & {
  decision: AgentStopClaimDecision | null;
  decisionTakenAt: number | null;
};

export class MemoryAgentStopClaimRepository extends AgentStopClaimRepository {
  private readonly claims = new Map<string, HeldClaim>();

  private constructor() {
    super();
  }

  static create(): MemoryAgentStopClaimRepository {
    return new MemoryAgentStopClaimRepository();
  }

  private key(organizationId: string, agentId: string): string {
    return `${organizationId}\u0000${agentId}`;
  }

  async create({
    organizationId,
    agentId,
    stopId,
    claimedAt,
  }: {
    organizationId: string;
    agentId: string;
    stopId: string;
    claimedAt: number;
  }): Promise<boolean> {
    const key = this.key(organizationId, agentId);
    if (this.claims.has(key)) return false;
    this.claims.set(key, {
      stopId,
      claimedAt,
      sentAt: null,
      decision: null,
      decisionTakenAt: null,
    });
    return true;
  }

  async findClaims({
    organizationId,
    agentId,
  }: {
    organizationId: string;
    agentId: string;
  }): Promise<AgentStopClaim[]> {
    const claim = this.claims.get(this.key(organizationId, agentId));
    return claim
      ? [{ stopId: claim.stopId, claimedAt: claim.claimedAt, sentAt: claim.sentAt }]
      : [];
  }

  async markSent({
    organizationId,
    agentId,
    stopId,
    sentAt,
  }: {
    organizationId: string;
    agentId: string;
    stopId: string;
    sentAt: number;
  }): Promise<void> {
    const claim = this.claims.get(this.key(organizationId, agentId));
    if (claim?.stopId === stopId) claim.sentAt = sentAt;
  }

  async takeDecision({
    organizationId,
    stopId,
    decision,
    takenAt,
    abandonedBefore,
  }: {
    organizationId: string;
    stopId: string;
    decision: AgentStopClaimDecision;
    takenAt: number;
    abandonedBefore: number;
  }): Promise<boolean> {
    const claim = this.claimOfStop(organizationId, stopId);
    if (!claim) return false;
    const abandoned = claim.decisionTakenAt !== null && claim.decisionTakenAt < abandonedBefore;
    if (claim.decision !== null && !abandoned) return false;
    claim.decision = decision;
    claim.decisionTakenAt = takenAt;
    return true;
  }

  async releaseDecision({
    organizationId,
    stopId,
    decision,
    takenAt,
  }: {
    organizationId: string;
    stopId: string;
    decision: AgentStopClaimDecision;
    takenAt: number;
  }): Promise<void> {
    const claim = this.claimOfStop(organizationId, stopId);
    if (claim?.decision !== decision || claim.decisionTakenAt !== takenAt) return;
    claim.decision = null;
    claim.decisionTakenAt = null;
  }

  async markDecisionSent({
    organizationId,
    stopId,
    decision,
    takenAt,
  }: {
    organizationId: string;
    stopId: string;
    decision: AgentStopClaimDecision;
    takenAt: number;
  }): Promise<void> {
    const claim = this.claimOfStop(organizationId, stopId);
    if (claim?.decision === decision && claim.decisionTakenAt === takenAt) {
      claim.decisionTakenAt = null;
    }
  }

  private claimOfStop(organizationId: string, stopId: string): HeldClaim | undefined {
    const prefix = `${organizationId}\u0000`;
    for (const [key, claim] of this.claims) {
      if (key.startsWith(prefix) && claim.stopId === stopId) return claim;
    }
    return undefined;
  }

  async swap({
    organizationId,
    agentId,
    fromStopId,
    toStopId,
    claimedAt,
    onlyIfUnsent,
  }: {
    organizationId: string;
    agentId: string;
    fromStopId: string;
    toStopId: string;
    claimedAt: number;
    onlyIfUnsent: boolean;
  }): Promise<boolean> {
    const key = this.key(organizationId, agentId);
    const held = this.claims.get(key);
    if (held?.stopId !== fromStopId) return false;
    if (onlyIfUnsent && held.sentAt !== null) return false;
    this.claims.set(key, {
      stopId: toStopId,
      claimedAt,
      sentAt: null,
      decision: null,
      decisionTakenAt: null,
    });
    return true;
  }

  async release({
    organizationId,
    agentId,
    stopId,
  }: {
    organizationId: string;
    agentId: string;
    stopId: string;
  }): Promise<void> {
    const key = this.key(organizationId, agentId);
    if (this.claims.get(key)?.stopId === stopId) this.claims.delete(key);
  }
}
