// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { beforeEach, describe, expect, it, vi } from "vitest";

const sendCrossing = vi.fn().mockResolvedValue(undefined);
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    eventSourcing: {
      getPipeline: () => ({
        commands: {
          recordBudgetCrossing: { send: sendCrossing },
          recordVkLifecycle: { send: vi.fn().mockResolvedValue(undefined) },
        },
      }),
    },
  }),
}));

import { detectBudgetCrossings } from "../services/governanceSignals.service";

function deps(spentByBudget: Record<string, string>, budgets: unknown[]) {
  return {
    prisma: {
      gatewayBudget: { findMany: vi.fn().mockResolvedValue(budgets) },
      project: { findMany: vi.fn().mockResolvedValue([{ id: "proj_1" }]) },
      gatewayBudgetBucketBoundary: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
    budgetCHRepository: {
      getSpendForTargetsAcrossTenants: vi
        .fn()
        .mockImplementation((_tenants: string[], targets: Array<{ budgetId: string; scope: string; scopeId: string }>) =>
          targets.map((t) => ({
            budgetId: t.budgetId,
            scope: t.scope,
            scopeId: t.scopeId,
            spentUsd: spentByBudget[t.budgetId] ?? "0",
          })),
        ),
    },
  } as never;
}

const budget = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  organizationId: "org_1",
  scopeType: "ATTRIBUTED_USER",
  scopeId: "vk_anchor",
  window: "MONTH",
  limitUsd: { toString: () => "100" },
  onBreach: "BLOCK",
  archivedAt: null,
  currentPeriodStartedAt: new Date("2026-07-01T00:00:00Z"),
  lastResetAt: null,
  providerKey: null,
  ...over,
});

const row = (budgetId: string, bucket: string) => ({
  tenantId: "proj_1",
  budgetId,
  bucketScopeId: bucket,
  endUserId: "user_1",
});

beforeEach(() => sendCrossing.mockClear());

describe("budget crossing detection", () => {
  /** @scenario Crossing detection reads the boundary-aware figure */
  it("appends threshold at the warn line, breach at the limit, nothing below", async () => {
    await detectBudgetCrossings(
      deps(
        { b_low: "10.000000", b_warn: "85.000000", b_over: "120.000000" },
        [budget("b_low"), budget("b_warn"), budget("b_over")],
      ),
      [row("b_low", "vk_anchor:u1"), row("b_warn", "vk_anchor:u2"), row("b_over", "vk_anchor:u3")],
    );
    const kinds = sendCrossing.mock.calls.map(
      (c) => [c[0].budget_id, c[0].kind] as const,
    );
    expect(kinds).toEqual([
      ["b_warn", "threshold_crossed"],
      ["b_over", "breached"],
    ]);
    const breach = sendCrossing.mock.calls[1]![0];
    expect(breach.bucket_scope_id).toBe("vk_anchor:u3");
    expect(breach.limit_usd).toBe("100.000000");
    expect(breach.spent_usd).toBe("120.000000");
    expect(breach.on_breach).toBe("block");
  });

  it("swallows detection failures so debits never depend on notifications", async () => {
    const failing = deps({}, [budget("b_1")]);
    (failing as { budgetCHRepository: { getSpendForTargetsAcrossTenants: ReturnType<typeof vi.fn> } }).budgetCHRepository.getSpendForTargetsAcrossTenants =
      vi.fn().mockRejectedValue(new Error("clickhouse down"));
    await expect(
      detectBudgetCrossings(failing, [row("b_1", "vk_anchor:u1")]),
    ).resolves.toBeUndefined();
    expect(sendCrossing).not.toHaveBeenCalled();
  });
});
