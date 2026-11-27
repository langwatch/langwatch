// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { AgentStopTargetPriorStateRepository } from "../agent-stop-target-prior-state.repository.ts";

type PriorStateDatabase = Pick<PrismaClient, "agentStopTargetPriorState">;

/** The primary key (organizationId, stopId, targetId) keeps the first value two writers race on. */
export class PrismaAgentStopTargetPriorStateRepository extends AgentStopTargetPriorStateRepository {
  private constructor(private readonly prisma: PriorStateDatabase) {
    super();
  }

  static create(prisma: PriorStateDatabase): PrismaAgentStopTargetPriorStateRepository {
    return new PrismaAgentStopTargetPriorStateRepository(prisma);
  }

  async recordOnce({
    organizationId,
    stopId,
    targetId,
    wasStopped,
    recordedAt,
  }: {
    organizationId: string;
    stopId: string;
    targetId: string;
    wasStopped: boolean;
    recordedAt: number;
  }): Promise<boolean> {
    await this.prisma.agentStopTargetPriorState.createMany({
      data: [{ organizationId, stopId, targetId, wasStopped, recordedAt: new Date(recordedAt) }],
      skipDuplicates: true,
    });
    const [stored] = await this.findPriorStates({ organizationId, stopId, targetId });
    return stored ?? wasStopped;
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
    const rows = await this.prisma.agentStopTargetPriorState.findMany({
      where: { organizationId, stopId, targetId },
      select: { wasStopped: true },
    });
    return rows.map((row) => row.wasStopped);
  }
}
