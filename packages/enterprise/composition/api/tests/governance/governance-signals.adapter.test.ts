// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type GatewayBudgetCrossingCandidate,
  type GovernanceBudgetCrossingData,
  type GovernanceResolvedBudgetCrossing,
  type GovernanceVkLifecycleData,
} from "@langwatch/enterprise-governance-server";
import { describe, expect, it, vi } from "vitest";
import {
  AppGovernanceSignalsService,
  GovernanceSignalDeliveryPort,
  GovernanceSignalStoragePort,
} from "../../src/governance/governance-signals.adapter";

class RecordingStorage extends GovernanceSignalStoragePort {
  readonly crossings: GovernanceResolvedBudgetCrossing[];
  readonly resolveBudgetCrossings = vi.fn(
    async (): Promise<GovernanceResolvedBudgetCrossing[]> => this.crossings,
  );

  constructor(crossings: GovernanceResolvedBudgetCrossing[]) {
    super();
    this.crossings = crossings;
  }

  async tryResolveLifecycleTenant(): Promise<string | null> {
    return "governance-project";
  }
}

class RecordingDelivery extends GovernanceSignalDeliveryPort {
  readonly crossings: GovernanceBudgetCrossingData[] = [];

  available(): boolean {
    return true;
  }

  async appendVirtualKeyLifecycle(_data: GovernanceVkLifecycleData): Promise<void> {}

  async appendBudgetCrossing(data: GovernanceBudgetCrossingData): Promise<void> {
    this.crossings.push(data);
  }
}

function candidate(budgetId: string): GatewayBudgetCrossingCandidate {
  return {
    tenantId: "governance-project",
    budgetId,
    bucketScopeId: `${budgetId}:user-1`,
    endUserId: "user-1",
  };
}

function crossing(input: {
  budgetId: string;
  spentUsd: string;
  periodStartedAtMs: number;
}): GovernanceResolvedBudgetCrossing {
  return {
    candidate: candidate(input.budgetId),
    budget: {
      id: input.budgetId,
      organizationId: "organization-1",
      scopeType: "ATTRIBUTED_USER",
      scopeId: "virtual-key-1",
      window: "MONTH",
      limitUsd: "100",
      onBreach: "BLOCK",
    },
    spentUsd: input.spentUsd,
    periodStartedAtMs: input.periodStartedAtMs,
  };
}

describe("AppGovernanceSignalsService", () => {
  it("delivers threshold and breach crossings, preserving the resolved period", async () => {
    const anchoredPeriodStartedAtMs = Date.parse("2026-06-17T09:00:00.000Z");
    const storage = new RecordingStorage([
      crossing({
        budgetId: "below",
        spentUsd: "10",
        periodStartedAtMs: anchoredPeriodStartedAtMs,
      }),
      crossing({
        budgetId: "warn",
        spentUsd: "85",
        periodStartedAtMs: anchoredPeriodStartedAtMs,
      }),
      crossing({
        budgetId: "breach",
        spentUsd: "120",
        periodStartedAtMs: anchoredPeriodStartedAtMs,
      }),
    ]);
    const delivery = new RecordingDelivery();

    await AppGovernanceSignalsService.create(storage, delivery).detectBudgetCrossings([
      candidate("below"),
      candidate("warn"),
      candidate("breach"),
    ]);

    expect(delivery.crossings).toEqual([
      expect.objectContaining({
        budget_id: "warn",
        kind: "threshold_crossed",
        period_started_at_ms: anchoredPeriodStartedAtMs,
      }),
      expect.objectContaining({
        budget_id: "breach",
        kind: "breached",
        bucket_scope_id: "breach:user-1",
        virtual_key_id: "virtual-key-1",
        limit_usd: "100.000000",
        spent_usd: "120.000000",
        on_breach: "block",
        period_started_at_ms: anchoredPeriodStartedAtMs,
      }),
    ]);
    expect(storage.resolveBudgetCrossings).toHaveBeenCalledOnce();
  });
});
