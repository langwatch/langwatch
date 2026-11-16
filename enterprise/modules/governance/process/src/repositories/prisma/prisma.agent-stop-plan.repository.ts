// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type AgentStopPlanTarget,
  agentStopTargetSchema,
} from "@langwatch/enterprise-governance-contract";
import { skipTenantCheck } from "@langwatch/prisma-client";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

import {
  type AgentStopPlanCount,
  AgentStopPlanRepository,
  type StoredAgentStopPlanTarget,
} from "../agent-stop-plan.repository.ts";

type PlanDatabase = Pick<PrismaClient, "agentStopPlanTarget" | "$transaction">;

type Row = {
  id: string;
  label: string;
  target: Prisma.JsonValue;
  updatedAt: Date;
};

function storedOf(row: Row): StoredAgentStopPlanTarget {
  return {
    id: row.id,
    label: row.label,
    target: agentStopTargetSchema.parse(row.target),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PrismaAgentStopPlanRepository extends AgentStopPlanRepository {
  private constructor(private readonly prisma: PlanDatabase) {
    super();
  }

  static create(prisma: PlanDatabase): PrismaAgentStopPlanRepository {
    return new PrismaAgentStopPlanRepository(prisma);
  }

  async findTargets({
    organizationId,
    agentId,
  }: {
    organizationId: string;
    agentId: string;
  }): Promise<StoredAgentStopPlanTarget[]> {
    const rows = await this.prisma.agentStopPlanTarget.findMany({
      where: { organizationId, agentId },
      orderBy: { position: "asc" },
      select: { id: true, label: true, target: true, updatedAt: true },
    });
    return rows.map(storedOf);
  }

  async replaceTargets({
    organizationId,
    agentId,
    targets,
  }: {
    organizationId: string;
    agentId: string;
    targets: readonly AgentStopPlanTarget[];
  }): Promise<StoredAgentStopPlanTarget[]> {
    return this.prisma.$transaction(async (transaction) => {
      // Taken even for an empty plan: a concurrent non-empty write could still insert rows.
      await transaction.$executeRaw` ${skipTenantCheck({
        // Advisory-lock helper, the key names one agent's plan.
        SKIP_TENANT_CHECK: true,
      })}
SELECT pg_advisory_xact_lock(hashtextextended(${`agent-stop-plan:${organizationId}:${agentId}`}, 0))`;
      await transaction.agentStopPlanTarget.deleteMany({ where: { organizationId, agentId } });
      if (targets.length > 0) {
        await transaction.agentStopPlanTarget.createMany({
          data: targets.map((target, position) => ({
            id: target.id,
            organizationId,
            agentId,
            position,
            label: target.label,
            target: target.target,
          })),
        });
      }
      const rows = await transaction.agentStopPlanTarget.findMany({
        where: { organizationId, agentId },
        orderBy: { position: "asc" },
        select: { id: true, label: true, target: true, updatedAt: true },
      });
      return rows.map(storedOf);
    });
  }

  async findPlanCounts({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AgentStopPlanCount[]> {
    const rows = await this.prisma.agentStopPlanTarget.groupBy({
      by: ["agentId"],
      where: { organizationId },
      _count: { _all: true },
    });
    return rows.map((row) => ({ agentId: row.agentId, targetCount: row._count._all }));
  }

  async findAgentIdsByAwsConnection({
    organizationId,
    awsConnectionId,
  }: {
    organizationId: string;
    awsConnectionId: string;
  }): Promise<string[]> {
    const rows = await this.prisma.agentStopPlanTarget.findMany({
      where: { organizationId, target: { path: ["awsConnectionId"], equals: awsConnectionId } },
      select: { agentId: true },
      distinct: ["agentId"],
    });
    return rows.map((row) => row.agentId);
  }
}
