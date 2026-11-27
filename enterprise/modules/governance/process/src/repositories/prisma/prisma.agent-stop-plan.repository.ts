// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type AgentStopPlanTarget,
  agentStopTargetSchema,
} from "@langwatch/enterprise-governance-contract";
import { skipTenantCheck } from "@langwatch/prisma-client";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import { awsConnectionsLockKey } from "../../features/kill-switch/rules/governance-aws-connection.rules.ts";
import {
  type AgentStopPlanCount,
  type AgentStopPlanReplacement,
  AgentStopPlanRepository,
  type StoredAgentStopPlan,
  type StoredAgentStopPlanTarget,
} from "../agent-stop-plan.repository.ts";

type PlanDatabase = Pick<PrismaClient, "agentStopPlanTarget" | "agentStopPlan" | "$transaction">;
type PlanTransaction = Pick<Prisma.TransactionClient, "agentStopPlanTarget" | "agentStopPlan">;

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

/** `whileLocked` checks every target against its owner inside the write; Prisma's 5s is tight. */
const PLAN_WRITE_TIMEOUT_MS = 30_000;

const TARGET_COLUMNS = { id: true, label: true, target: true, updatedAt: true } as const;

async function readPlan({
  transaction,
  organizationId,
  agentId,
}: {
  transaction: PlanTransaction;
  organizationId: string;
  agentId: string;
}): Promise<StoredAgentStopPlan> {
  const header = await transaction.agentStopPlan.findUnique({
    where: { organizationId_agentId: { organizationId, agentId } },
    select: { version: true, updatedAt: true },
  });
  const rows = await transaction.agentStopPlanTarget.findMany({
    where: { organizationId, agentId },
    orderBy: { position: "asc" },
    select: TARGET_COLUMNS,
  });
  return {
    version: header?.version ?? 0,
    updatedAt: header?.updatedAt.toISOString() ?? null,
    targets: rows.map(storedOf),
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
      select: TARGET_COLUMNS,
    });
    return rows.map(storedOf);
  }

  /** One snapshot for both reads, so the version always names the targets returned with it. */
  async getPlan({
    organizationId,
    agentId,
  }: {
    organizationId: string;
    agentId: string;
  }): Promise<StoredAgentStopPlan> {
    return this.prisma.$transaction(
      (transaction) => readPlan({ transaction, organizationId, agentId }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async replaceTargets({
    organizationId,
    agentId,
    targets,
    expectedVersion,
    whileLocked,
  }: {
    organizationId: string;
    agentId: string;
    targets: readonly AgentStopPlanTarget[];
    expectedVersion?: number;
    whileLocked?: () => Promise<void>;
  }): Promise<AgentStopPlanReplacement> {
    return this.prisma.$transaction(
      async (transaction): Promise<AgentStopPlanReplacement> => {
        // Taken even for an empty plan: a concurrent non-empty write could still insert rows.
        await transaction.$executeRaw` ${skipTenantCheck({
          // Advisory-lock helper, the key names one agent's plan.
          SKIP_TENANT_CHECK: true,
        })}
SELECT pg_advisory_xact_lock(hashtextextended(${`agent-stop-plan:${organizationId}:${agentId}`}, 0))`;
        const header = await transaction.agentStopPlan.findUnique({
          where: { organizationId_agentId: { organizationId, agentId } },
          select: { version: true },
        });
        const version = header?.version ?? 0;
        if (expectedVersion !== undefined && expectedVersion !== version) {
          return { outcome: "conflict", version };
        }
        if (targets.some(({ target }) => target.kind === "bedrock_agent_alias")) {
          await transaction.$executeRaw` ${skipTenantCheck({
            // Advisory-lock helper, the key names one organisation's AWS connections.
            SKIP_TENANT_CHECK: true,
          })}
SELECT pg_advisory_xact_lock(hashtextextended(${awsConnectionsLockKey(organizationId)}, 0))`;
        }
        await whileLocked?.();
        await transaction.agentStopPlan.upsert({
          where: { organizationId_agentId: { organizationId, agentId } },
          create: { organizationId, agentId, version: version + 1 },
          update: { version: version + 1 },
        });
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
        return {
          outcome: "saved",
          plan: await readPlan({ transaction, organizationId, agentId }),
        };
      },
      { timeout: PLAN_WRITE_TIMEOUT_MS },
    );
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
