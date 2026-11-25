// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { AgentStopTargetPriorStateRepository } from "../agent-stop-target-prior-state.repository.ts";

export class MemoryAgentStopTargetPriorStateRepository extends AgentStopTargetPriorStateRepository {
  private readonly states = new Map<string, boolean>();

  private constructor() {
    super();
  }

  static create(): MemoryAgentStopTargetPriorStateRepository {
    return new MemoryAgentStopTargetPriorStateRepository();
  }

  private key(organizationId: string, stopId: string, targetId: string): string {
    return `${organizationId}\u0000${stopId}\u0000${targetId}`;
  }

  async recordOnce({
    organizationId,
    stopId,
    targetId,
    wasStopped,
  }: {
    organizationId: string;
    stopId: string;
    targetId: string;
    wasStopped: boolean;
    recordedAt: number;
  }): Promise<boolean> {
    const key = this.key(organizationId, stopId, targetId);
    const stored = this.states.get(key);
    if (stored !== undefined) return stored;
    this.states.set(key, wasStopped);
    return wasStopped;
  }

  async findPriorStates({
    organizationId,
    stopId,
    targetId,
  }: {
    organizationId: string;
    stopId: string;
    targetId: string;
  }): Promise<boolean[]> {
    const stored = this.states.get(this.key(organizationId, stopId, targetId));
    return stored === undefined ? [] : [stored];
  }
}
