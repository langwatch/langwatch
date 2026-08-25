// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GatewayDebitPort,
  GatewayDebitProcess,
  type GatewayBudgetCrossingCandidate,
  type GatewayBudgetDebitRow,
  type GatewayResolvedBudget,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import type { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import type { BudgetChangeEventDedupeService } from "~/server/gateway/budgetChangeEventDedupe.service";
import {
  budgetAppliesToProvider,
  resolveApplicableBudgets,
} from "~/server/gateway/budgetResolution.service";
import { ChangeEventRepository } from "~/server/gateway/changeEvent.repository";
import { AppGovernanceSignalsService } from "./governance-signals.adapter";

const logger = createLogger("langwatch:governance:gateway-debits");

export type AppGatewayDebitAdapterDependencies = {
  prisma: PrismaClient;
  budgetCHRepository: GatewayBudgetClickHouseRepository;
  changeEventDedupe?: BudgetChangeEventDedupeService;
};

class AppGatewayDebitPort extends GatewayDebitPort {
  private readonly signals: AppGovernanceSignalsService;

  private constructor(private readonly dependencies: AppGatewayDebitAdapterDependencies) {
    super();
    this.signals = AppGovernanceSignalsService.create(dependencies);
  }

  static create(dependencies: AppGatewayDebitAdapterDependencies): AppGatewayDebitPort {
    return new AppGatewayDebitPort(dependencies);
  }

  async resolve(input: Parameters<GatewayDebitPort["resolve"]>[0]) {
    const resolved = await resolveApplicableBudgets({
      client: this.dependencies.prisma,
      target: input.target,
    });
    return resolved
      .filter(({ budget }) => budgetAppliesToProvider(budget, input.providerKey))
      .map(({ budget, bucketScopeId, endUserId }): GatewayResolvedBudget => ({
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

  async insert(rows: GatewayBudgetDebitRow[]): Promise<void> {
    try {
      await this.dependencies.budgetCHRepository.insertDebitsForBudgets(rows);
    } catch (error) {
      logger.error({ error }, "failed to write gateway budget debits");
      throw error;
    }
  }

  detectCrossings(rows: GatewayBudgetCrossingCandidate[]): Promise<void> {
    return this.signals.detectBudgetCrossings(rows);
  }

  shouldEmitBudgetUpdated(input: { projectId: string }): Promise<boolean> {
    return this.dependencies.changeEventDedupe
      ? this.dependencies.changeEventDedupe.shouldEmit(input)
      : Promise.resolve(true);
  }

  async emitBudgetUpdated(input: {
    organizationId: string;
    projectId: string;
    gatewayRequestId: string;
    virtualKeyId: string;
    budgetIds: string[];
  }): Promise<void> {
    try {
      await new ChangeEventRepository(this.dependencies.prisma).append({
        organizationId: input.organizationId,
        projectId: input.projectId,
        kind: "BUDGET_UPDATED",
        payload: {
          gatewayRequestId: input.gatewayRequestId,
          virtualKeyId: input.virtualKeyId,
          budgetIds: input.budgetIds,
        },
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
    private readonly dependencies: AppGatewayDebitAdapterDependencies,
  ) {}

  static create(
    dependencies: AppGatewayDebitAdapterDependencies,
  ): AppGatewayDebitAdapter {
    return new AppGatewayDebitAdapter(dependencies);
  }

  build(): GatewayDebitProcess {
    return GatewayDebitProcess.create(AppGatewayDebitPort.create(this.dependencies));
  }
}
