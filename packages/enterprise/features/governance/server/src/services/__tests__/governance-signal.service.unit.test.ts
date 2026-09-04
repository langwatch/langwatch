// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Budget-crossing detection: which buckets append a threshold or breach
 * signal, and that a failure in detection never surfaces to the debit that
 * triggered it. Ported from
 * platform/app/ee/governance/__tests__/governanceSignals.unit.test.ts
 * (retired application); the boundary-aware spent figure it exercised is
 * resolved by the caller (`resolveBudgetCrossings`), so this suite fakes
 * that figure at the port rather than recomputing it.
 */
import { describe, expect, it } from "vitest";
import type {
  GovernanceBudgetCrossingData,
  GovernanceVkLifecycleData,
} from "../../ports/governance-webhook.port";
import type {
  GatewayBudgetCrossingCandidate,
  GatewayBudgetScope,
  GatewayBudgetWindow,
} from "../../ports/gateway-debit.port";
import {
  GovernanceSignalPort,
  type GovernanceResolvedBudgetCrossing,
} from "../../ports/governance-signal.port";
import { GovernanceSignalService } from "../governance-signal.service";

function candidate(budgetId: string, bucketScopeId: string): GatewayBudgetCrossingCandidate {
  return { tenantId: "proj_1", budgetId, bucketScopeId, endUserId: null };
}

function resolved(
  budgetId: string,
  spentUsd: string,
  overrides: Partial<GovernanceResolvedBudgetCrossing["budget"]> = {},
): GovernanceResolvedBudgetCrossing {
  return {
    candidate: candidate(budgetId, `vk_anchor:${budgetId}`),
    budget: {
      id: budgetId,
      organizationId: "org_1",
      scopeType: "VIRTUAL_KEY" as GatewayBudgetScope,
      scopeId: "vk_1",
      window: "MONTH" as GatewayBudgetWindow,
      limitUsd: "100.000000",
      onBreach: "BLOCK",
      ...overrides,
    },
    spentUsd,
    periodStartedAtMs: 0,
  };
}

class FakeGovernanceSignalPort extends GovernanceSignalPort {
  appendedCrossings: GovernanceBudgetCrossingData[] = [];
  private readonly resolvedRows: GovernanceResolvedBudgetCrossing[];
  private readonly resolveError: Error | null;

  constructor(resolvedRows: GovernanceResolvedBudgetCrossing[], resolveError: Error | null = null) {
    super();
    this.resolvedRows = resolvedRows;
    this.resolveError = resolveError;
  }

  available(): boolean {
    return true;
  }

  now(): Date {
    return new Date("2026-08-01T00:00:00.000Z");
  }

  async tryResolveLifecycleTenant(): Promise<string | null> {
    return null;
  }

  async resolveBudgetCrossings(): Promise<GovernanceResolvedBudgetCrossing[]> {
    if (this.resolveError) throw this.resolveError;
    return this.resolvedRows;
  }

  async appendVirtualKeyLifecycle(_data: GovernanceVkLifecycleData): Promise<void> {}

  async appendBudgetCrossing(data: GovernanceBudgetCrossingData): Promise<void> {
    this.appendedCrossings.push(data);
  }
}

describe("GovernanceSignalService.detectBudgetCrossings", () => {
  describe("given a bucket below the threshold, one above it, and one past the limit", () => {
    /** @scenario Crossing detection reads the boundary-aware figure */
    it("appends a threshold crossing only above the threshold and a breach only past the limit", async () => {
      const port = new FakeGovernanceSignalPort([
        resolved("b_low", "10.000000"),
        resolved("b_warn", "85.000000"),
        resolved("b_over", "120.000000"),
      ]);
      const service = GovernanceSignalService.create(port);

      await service.detectBudgetCrossings([
        candidate("b_low", "vk_anchor:b_low"),
        candidate("b_warn", "vk_anchor:b_warn"),
        candidate("b_over", "vk_anchor:b_over"),
      ]);

      const kinds = port.appendedCrossings.map((c) => [c.budget_id, c.kind]);
      expect(kinds).toEqual([
        ["b_warn", "threshold_crossed"],
        ["b_over", "breached"],
      ]);
      const breach = port.appendedCrossings[1]!;
      expect(breach.limit_usd).toBe("100.000000");
      expect(breach.spent_usd).toBe("120.000000");
      expect(breach.on_breach).toBe("block");
    });

    it("never fails the debit that triggered it when detection itself fails", async () => {
      const port = new FakeGovernanceSignalPort([], new Error("boom"));
      const service = GovernanceSignalService.create(port);

      await expect(
        service.detectBudgetCrossings([candidate("b_any", "vk_anchor:b_any")]),
      ).resolves.toBeUndefined();
    });
  });
});
