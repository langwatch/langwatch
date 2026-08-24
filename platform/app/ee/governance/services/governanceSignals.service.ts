// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GovernanceDiagnosticsPort,
  GovernanceSignalPort,
  GovernanceSignalService,
  type GatewayBudgetCrossingCandidate,
  type GovernanceBudgetCrossingData,
  type GovernanceResolvedBudgetCrossing,
  type GovernanceVirtualKeyLifecycleSignal,
  type GovernanceVkLifecycleData,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";
import type { GatewayBudget, PrismaClient } from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer/app";
import { GOVERNANCE_EVENTS_PIPELINE_NAME } from "~/server/event-sourcing/pipelines/governance-events/schemas/constants";
import type {
  BudgetSpendTarget,
  GatewayBudgetClickHouseRepository,
} from "~/server/gateway/budget.clickhouse.repository";
import {
  budgetPeriodFloorMs,
  currentPeriodStart,
} from "~/server/gateway/budgetPeriod";

const logger = createLogger("langwatch:governance:signals");

type GovernanceCommands = Record<
  string,
  { send: (payload: unknown) => Promise<unknown> }
>;

export type AppGovernanceSignalsDependencies = {
  prisma: PrismaClient;
  budgetCHRepository?: GatewayBudgetClickHouseRepository;
};

class AppGovernanceSignalDiagnostics extends GovernanceDiagnosticsPort {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

class AppGovernanceSignalPort extends GovernanceSignalPort {
  private constructor(
    private readonly dependencies: AppGovernanceSignalsDependencies,
  ) {
    super();
  }

  static create(
    dependencies: AppGovernanceSignalsDependencies,
  ): AppGovernanceSignalPort {
    return new AppGovernanceSignalPort(dependencies);
  }

  available(): boolean {
    return this.commands() !== null;
  }

  now(): Date {
    return new Date();
  }

  async resolveLifecycleTenant(input: {
    organizationId: string;
    preferredProjectId: string | null;
  }): Promise<string | null> {
    if (input.preferredProjectId) return input.preferredProjectId;
    const project = await this.dependencies.prisma.project.findFirst({
      where: { team: { organizationId: input.organizationId } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    return project?.id ?? null;
  }

  async resolveBudgetCrossings(
    candidates: GatewayBudgetCrossingCandidate[],
    now: Date,
  ): Promise<GovernanceResolvedBudgetCrossing[]> {
    const repository = this.dependencies.budgetCHRepository;
    if (!repository) {
      throw new Error("gateway budget repository is not configured");
    }
    const budgetIds = [...new Set(candidates.map(({ budgetId }) => budgetId))];
    const budgets = await this.dependencies.prisma.gatewayBudget.findMany({
      where: { id: { in: budgetIds }, archivedAt: null },
    });
    const budgetById = new Map(budgets.map((budget) => [budget.id, budget]));
    const liveCandidates = candidates.filter(({ budgetId }) =>
      budgetById.has(budgetId),
    );
    if (liveCandidates.length === 0) return [];

    const organizationIds = [
      ...new Set(budgets.map(({ organizationId }) => organizationId)),
    ];
    const projects = await this.dependencies.prisma.project.findMany({
      where: { team: { organizationId: { in: organizationIds } } },
      select: { id: true },
    });
    if (projects.length === 0) return [];

    const boundaries =
      await this.dependencies.prisma.gatewayBudgetBucketBoundary.findMany({
        where: {
          organizationId: { in: organizationIds },
          budgetId: { in: budgetIds },
        },
      });
    const boundaryByKey = new Map(
      boundaries.map((boundary) => [
        `${boundary.budgetId}:${boundary.bucketScopeId}`,
        boundary.periodStartedAt.getTime(),
      ]),
    );
    const targets = liveCandidates.map((candidate) =>
      this.spendTarget(
        candidate,
        budgetById.get(candidate.budgetId)!,
        boundaryByKey,
        now,
      ),
    );
    const spends = await repository.getSpendForTargetsAcrossTenants(
      projects.map(({ id }) => id),
      targets,
      now,
    );
    const spentByBudget = new Map(
      spends.map(({ budgetId, spentUsd }) => [budgetId, spentUsd]),
    );
    return liveCandidates.map((candidate, index) => {
      const budget = budgetById.get(candidate.budgetId)!;
      const target = targets[index]!;
      return {
        candidate,
        budget: {
          id: budget.id,
          organizationId: budget.organizationId,
          scopeType: budget.scopeType,
          scopeId: budget.scopeId,
          window: budget.window,
          limitUsd: budget.limitUsd.toString(),
          onBreach: budget.onBreach,
        },
        spentUsd: spentByBudget.get(candidate.budgetId) ?? "0",
        periodStartedAtMs:
          target.periodFloorMs ??
          currentPeriodStart(budget.window, now).getTime(),
      };
    });
  }

  async appendVirtualKeyLifecycle(
    data: GovernanceVkLifecycleData,
  ): Promise<void> {
    await this.commands()?.recordVkLifecycle?.send(data);
  }

  async appendBudgetCrossing(
    data: GovernanceBudgetCrossingData,
  ): Promise<void> {
    await this.commands()?.recordBudgetCrossing?.send(data);
  }

  private commands(): GovernanceCommands | null {
    try {
      const pipeline = getApp().eventSourcing?.getPipeline(
        GOVERNANCE_EVENTS_PIPELINE_NAME,
      );
      return (pipeline?.commands as GovernanceCommands | undefined) ?? null;
    } catch {
      return null;
    }
  }

  private spendTarget(
    candidate: GatewayBudgetCrossingCandidate,
    budget: GatewayBudget,
    boundaryByKey: Map<string, number>,
    now: Date,
  ): BudgetSpendTarget {
    const floors = [
      budgetPeriodFloorMs(budget, now),
      boundaryByKey.get(`${candidate.budgetId}:${candidate.bucketScopeId}`),
    ].filter((value): value is number => typeof value === "number");
    return {
      budgetId: budget.id,
      scope: budget.scopeType,
      scopeId: candidate.bucketScopeId,
      window: budget.window,
      match: "exact",
      periodFloorMs: floors.length > 0 ? Math.max(...floors) : undefined,
    };
  }
}

export class AppGovernanceSignalsService {
  private constructor(private readonly service: GovernanceSignalService) {}

  static create(
    dependencies: AppGovernanceSignalsDependencies,
  ): AppGovernanceSignalsService {
    return new AppGovernanceSignalsService(
      GovernanceSignalService.create(
        AppGovernanceSignalPort.create(dependencies),
        new AppGovernanceSignalDiagnostics(),
      ),
    );
  }

  emitVirtualKeyLifecycle(
    signal: GovernanceVirtualKeyLifecycleSignal,
  ): Promise<void> {
    return this.service.emitVirtualKeyLifecycle(signal);
  }

  detectBudgetCrossings(
    candidates: GatewayBudgetCrossingCandidate[],
  ): Promise<void> {
    return this.service.detectBudgetCrossings(candidates);
  }
}
