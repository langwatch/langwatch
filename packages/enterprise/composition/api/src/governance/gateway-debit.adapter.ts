// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GatewayDebitPort,
  GatewayDebitProcess,
  type GatewayBudgetCrossingCandidate,
  type GatewayBudgetDebitRow,
  type GatewayResolvedBudget,
  type GovernanceResolvedBudgetCrossing,
} from "@langwatch/enterprise-governance-server";
import {
  budgetAppliesToProvider,
  budgetPeriodFloorMs,
  currentPeriodStart,
  type BudgetSpendTarget,
  type GatewayChangeEventsPort,
} from "@langwatch/gateway-server";
import type { GatewayService } from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import type { GatewayBudget, PrismaClient } from "@langwatch/prisma-client/generated";
import {
  AppGovernanceSignalsService,
  GovernanceSignalDeliveryPort,
  GovernanceSignalStoragePort,
} from "./governance-signals.adapter";

const logger = createLogger("langwatch:governance:gateway-debits");

class DisabledGovernanceSignalDeliveryPort extends GovernanceSignalDeliveryPort {
  available(): boolean {
    return false;
  }

  async appendVirtualKeyLifecycle(): Promise<void> {}

  async appendBudgetCrossing(): Promise<void> {}
}

export type GovernanceBudgetResolutionInput = {
  target: {
    organizationId: string;
    teamId: string | null;
    projectId: string;
    virtualKeyId: string;
    principalUserId: string | null;
    endUserId: string | null;
  };
  providerKey: string | null;
};

/** Complete API-process bridge to the Gateway runtime. */
export abstract class GatewayGovernancePort extends GovernanceSignalStoragePort {
  abstract resolveBudgetDebits(
    input: GovernanceBudgetResolutionInput,
  ): Promise<GatewayResolvedBudget[]>;
  abstract insertBudgetDebits(rows: GatewayBudgetDebitRow[]): Promise<void>;
  abstract shouldEmitBudgetUpdated(input: { projectId: string }): Promise<boolean>;
  abstract appendBudgetUpdated(input: {
    organizationId: string;
    projectId: string;
    gatewayRequestId: string;
    virtualKeyId: string;
    budgetIds: string[];
  }): Promise<void>;
}

export abstract class GatewayGovernanceBudgetStore {
  abstract insertDebitsForBudgets(rows: GatewayBudgetDebitRow[]): Promise<void>;

  abstract getSpendForTargetsAcrossTenants(
    tenantIds: string[],
    targets: BudgetSpendTarget[],
    now: Date,
  ): Promise<Array<{ budgetId: string; spentUsd: string }>>;
}

export abstract class GatewayBudgetChangeEventDedupe {
  abstract shouldEmit(input: { projectId: string }): Promise<boolean>;
}

/** Bridges the core Gateway stores to Enterprise Governance at process composition. */
export class AppGatewayGovernancePort extends GatewayGovernancePort {
  private constructor(
    private readonly database: PrismaClient,
    private readonly budgets: GatewayGovernanceBudgetStore,
    private readonly budgetDecisions: GatewayService,
    private readonly gatewayChanges: GatewayChangeEventsPort,
    private readonly changeEvents: GatewayBudgetChangeEventDedupe | undefined,
  ) {
    super();
  }

  static create(
    database: PrismaClient,
    budgets: GatewayGovernanceBudgetStore,
    budgetDecisions: GatewayService,
    gatewayChanges: GatewayChangeEventsPort,
    changeEvents?: GatewayBudgetChangeEventDedupe,
  ): AppGatewayGovernancePort {
    return new AppGatewayGovernancePort(
      database,
      budgets,
      budgetDecisions,
      gatewayChanges,
      changeEvents,
    );
  }

  async resolveBudgetDebits(input: GovernanceBudgetResolutionInput) {
    const resolved = await this.budgetDecisions.resolveApplicableBudgets(input.target);

    return resolved
      .filter(({ budget }) => budgetAppliesToProvider(budget, input.providerKey))
      .map(({ budget, bucketScopeId, endUserId }) => ({
        budget: {
          id: budget.id,
          scopeType: budget.scopeType,
          window: budget.window,
          onBreach: budget.onBreach,
        },
        bucketScopeId,
        endUserId,
      }));
  }

  insertBudgetDebits(rows: GatewayBudgetDebitRow[]): Promise<void> {
    return this.budgets.insertDebitsForBudgets(rows);
  }

  shouldEmitBudgetUpdated(input: { projectId: string }): Promise<boolean> {
    return this.changeEvents?.shouldEmit(input) ?? Promise.resolve(true);
  }

  async appendBudgetUpdated(input: {
    organizationId: string;
    projectId: string;
    gatewayRequestId: string;
    virtualKeyId: string;
    budgetIds: string[];
  }): Promise<void> {
    await this.gatewayChanges.append({
      organizationId: input.organizationId,
      projectId: input.projectId,
      kind: "BUDGET_UPDATED",
      payload: {
        gatewayRequestId: input.gatewayRequestId,
        virtualKeyId: input.virtualKeyId,
        budgetIds: input.budgetIds,
      },
    });
  }

  async tryResolveLifecycleTenant(input: {
    organizationId: string;
    preferredProjectId: string | null;
  }): Promise<string | null> {
    if (input.preferredProjectId) {
      return input.preferredProjectId;
    }

    const project = await this.database.project.findFirst({
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
    const budgetIds = [...new Set(candidates.map(({ budgetId }) => budgetId))];
    const budgets = await this.database.gatewayBudget.findMany({
      where: { id: { in: budgetIds }, archivedAt: null },
    });
    const budgetById = new Map(budgets.map((budget) => [budget.id, budget]));
    const liveCandidates = candidates.filter(({ budgetId }) => budgetById.has(budgetId));

    if (liveCandidates.length === 0) {
      return [];
    }

    const organizationIds = [
      ...new Set(budgets.map(({ organizationId }) => organizationId)),
    ];
    const projects = await this.database.project.findMany({
      where: { team: { organizationId: { in: organizationIds } } },
      select: { id: true },
    });

    if (projects.length === 0) {
      return [];
    }

    const boundaries = await this.database.gatewayBudgetBucketBoundary.findMany({
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
      toBudgetSpendTarget(
        candidate,
        getResolvedBudget(budgetById, candidate.budgetId),
        boundaryByKey,
        now,
      ),
    );
    const spends = await this.budgets.getSpendForTargetsAcrossTenants(
      projects.map(({ id }) => id),
      targets,
      now,
    );
    const spentByBudget = new Map(
      spends.map(({ budgetId, spentUsd }) => [budgetId, spentUsd]),
    );

    return liveCandidates.map((candidate, index) => {
      const budget = getResolvedBudget(budgetById, candidate.budgetId);
      const target = targets[index];
      if (!target) {
        throw new Error(`Missing spend target for budget ${candidate.budgetId}`);
      }

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
          target.periodFloorMs ?? currentPeriodStart(budget.window, now).getTime(),
      };
    });
  }
}

function getResolvedBudget(
  budgets: Map<string, GatewayBudget>,
  budgetId: string,
): GatewayBudget {
  const budget = budgets.get(budgetId);
  if (!budget) {
    throw new Error(`Missing resolved budget ${budgetId}`);
  }

  return budget;
}

function toBudgetSpendTarget(
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
    periodFloorMs: floors.length > 0 ? Math.max(...floors) : void 0,
  };
}

class AppGatewayDebitPort extends GatewayDebitPort {
  private constructor(
    private readonly gateway: GatewayGovernancePort,
    private readonly signals: AppGovernanceSignalsService,
  ) {
    super();
  }

  static create(
    gateway: GatewayGovernancePort,
    delivery: GovernanceSignalDeliveryPort = new DisabledGovernanceSignalDeliveryPort(),
  ): AppGatewayDebitPort {
    const signals = AppGovernanceSignalsService.create(gateway, delivery);
    return new AppGatewayDebitPort(gateway, signals);
  }

  async resolve(input: GovernanceBudgetResolutionInput) {
    return this.gateway.resolveBudgetDebits(input);
  }

  async insert(rows: GatewayBudgetDebitRow[]): Promise<void> {
    try {
      await this.gateway.insertBudgetDebits(rows);
    } catch (error) {
      logger.error({ error }, "failed to write gateway budget debits");
      throw error;
    }
  }

  detectCrossings(rows: GatewayBudgetCrossingCandidate[]): Promise<void> {
    return this.signals.detectBudgetCrossings(rows);
  }

  shouldEmitBudgetUpdated(input: { projectId: string }): Promise<boolean> {
    return this.gateway.shouldEmitBudgetUpdated(input);
  }

  async emitBudgetUpdated(input: {
    organizationId: string;
    projectId: string;
    gatewayRequestId: string;
    virtualKeyId: string;
    budgetIds: string[];
  }): Promise<void> {
    try {
      await this.gateway.appendBudgetUpdated({
        organizationId: input.organizationId,
        projectId: input.projectId,
        gatewayRequestId: input.gatewayRequestId,
        virtualKeyId: input.virtualKeyId,
        budgetIds: input.budgetIds,
      });
    } catch (error) {
      logger.warn(
        {
          projectId: input.projectId,
          virtualKeyId: input.virtualKeyId,
          gatewayRequestId: input.gatewayRequestId,
          error,
        },
        "failed to emit BUDGET_UPDATED change event after debiting",
      );
      throw error;
    }
  }
}

export class AppGatewayDebitAdapter {
  private constructor(
    private readonly gateway: GatewayGovernancePort,
    private readonly delivery: GovernanceSignalDeliveryPort,
  ) {}

  static create(
    gateway: GatewayGovernancePort,
    delivery: GovernanceSignalDeliveryPort,
  ): AppGatewayDebitAdapter {
    return new AppGatewayDebitAdapter(gateway, delivery);
  }

  build(): GatewayDebitProcess {
    return GatewayDebitProcess.create(
      AppGatewayDebitPort.create(this.gateway, this.delivery),
    );
  }
}
