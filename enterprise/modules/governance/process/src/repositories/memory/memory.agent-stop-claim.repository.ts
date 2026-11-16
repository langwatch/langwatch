// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { type AgentStopClaim, AgentStopClaimRepository } from "../agent-stop-claim.repository.ts";

export class MemoryAgentStopClaimRepository extends AgentStopClaimRepository {
  private readonly claims = new Map<string, AgentStopClaim>();

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
    this.claims.set(key, { stopId, claimedAt });
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
    return claim ? [{ ...claim }] : [];
  }

  async swap({
    organizationId,
    agentId,
    fromStopId,
    toStopId,
    claimedAt,
  }: {
    organizationId: string;
    agentId: string;
    fromStopId: string;
    toStopId: string;
    claimedAt: number;
  }): Promise<boolean> {
    const key = this.key(organizationId, agentId);
    if (this.claims.get(key)?.stopId !== fromStopId) return false;
    this.claims.set(key, { stopId: toStopId, claimedAt });
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
