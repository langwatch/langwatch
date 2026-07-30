/**
 * Unit tests for the `gatewayBudgetDebits` write side (ADR-107 decision 17,
 * pre-built).
 *
 * The properties that matter: a failed write is REPORTED, not swallowed —
 * a swallowed error would silently delete spend already incurred — and
 * re-deriving the same events (a replay) does not charge twice, since the
 * ledger aggregates at INSERT time in a materialised view that does not
 * collapse.
 *
 * The ClickHouse repository is modelled as a fake reproducing the real
 * probe-then-insert contract.
 */

import { GatewayBudgetDebitService } from "@ee/governance/services/gatewayBudgetDebit.service";
import type { GatewayBudget } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BudgetDebitRow } from "~/server/gateway/budget.clickhouse.repository";
import type { ResolvedBudget } from "~/server/gateway/budgetResolution.service";
import type { GatewayBudgetDebitRecord } from "../gatewayBudgetDebits.mapProjection";
import { createGatewayBudgetDebitsStore } from "../gatewayBudgetDebits.store";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

/** Stand-in for `gateway_budget_ledger_events` + its rollup. */
class FakeLedger {
  readonly rows: BudgetDebitRow[] = [];

  insertDebit = vi.fn(
    async (rows: BudgetDebitRow[]): Promise<{ inserted: boolean }> => {
      if (rows.length === 0) return { inserted: false };
      const requestId = rows[0]!.gatewayRequestId;
      if (this.rows.some((r) => r.gatewayRequestId === requestId))
        return { inserted: false };
      this.rows.push(...rows);
      return { inserted: true };
    },
  );

  insertDebits = vi.fn(
    async (
      rows: BudgetDebitRow[],
    ): Promise<{ insertedGatewayRequestIds: string[] }> => {
      const present = new Set(this.rows.map((r) => r.gatewayRequestId));
      const toInsert = rows.filter((r) => !present.has(r.gatewayRequestId));
      this.rows.push(...toInsert);
      return {
        insertedGatewayRequestIds: [
          ...new Set(toInsert.map((r) => r.gatewayRequestId)),
        ],
      };
    },
  );

  spendFor(budgetId: string): number {
    return this.rows
      .filter((r) => r.budgetId === budgetId)
      .reduce((total, r) => total + Number(r.amountUsd), 0);
  }
}

function budget(overrides: Partial<GatewayBudget> = {}): ResolvedBudget {
  const b = {
    id: "budget-project",
    scopeType: "PROJECT",
    scopeId: "project-1",
    window: "MONTH",
    providerKey: null,
    ...overrides,
  } as GatewayBudget;
  return {
    budget: b,
    bucketScopeId: b.scopeId,
    principalUserId: null,
    groupId: null,
  };
}

const RECORD: GatewayBudgetDebitRecord = {
  tenantId: "project-1",
  traceId: "trace-1",
  virtualKeyId: "vk-1",
  gatewayRequestId: "grq_01H",
  amountUsd: "0.0012500000",
  tokensInput: 100,
  tokensOutput: 50,
  model: "gpt-5-mini",
  providerKey: null,
  status: "SUCCESS",
  durationMs: 2000,
  occurredAt: new Date(1_700_000_000_500),
};

const BATCH_CONTEXT = { tenantId: "project-1" };

const VK_SCOPED_AT_PROJECT_1 = {
  id: "vk-1",
  organizationId: "org-1",
  principalUserId: null,
  scopes: [{ scopeId: "project-1" }],
};

function buildStore({
  vk = VK_SCOPED_AT_PROJECT_1,
  project = {
    id: "project-1",
    teamId: "team-1",
    kind: "application",
    team: { organizationId: "org-1" },
  },
  budgets = [budget()],
  ledger = new FakeLedger(),
  appendChangeEvent = vi.fn().mockResolvedValue({ revision: 1n }),
}: {
  vk?: unknown;
  project?: unknown;
  budgets?: ResolvedBudget[];
  ledger?: FakeLedger;
  appendChangeEvent?: ReturnType<typeof vi.fn>;
} = {}) {
  const prisma = {
    virtualKey: {
      findUnique: vi.fn().mockResolvedValue(vk),
      findMany: vi.fn().mockResolvedValue(vk ? [vk] : []),
    },
    project: { findUnique: vi.fn().mockResolvedValue(project) },
  };
  const resolveForRequest = vi.fn().mockResolvedValue(budgets);
  const store = createGatewayBudgetDebitsStore({
    debits: new GatewayBudgetDebitService({
      prisma: prisma as never,
      budgetRepository: { resolveForRequest } as never,
    }),
    budgetCHRepository: ledger as never,
    changeEvents: { append: appendChangeEvent } as never,
  });
  return { store, prisma, ledger, appendChangeEvent, resolveForRequest };
}

function requests(...ids: string[]): GatewayBudgetDebitRecord[] {
  return ids.map((gatewayRequestId) => ({ ...RECORD, gatewayRequestId }));
}

describe("GatewayBudgetDebitsAppendStore", () => {
  beforeEach(() => vi.clearAllMocks());

  it("charges every request in the window", async () => {
    const { store, ledger } = buildStore();

    await store.writeBatch(requests("grq_A", "grq_B", "grq_C"), BATCH_CONTEXT);

    expect(ledger.rows.map((r) => r.gatewayRequestId)).toEqual([
      "grq_A",
      "grq_B",
      "grq_C",
    ]);
  });

  it("carries the derived amount, tokens, model and business time onto every row", async () => {
    const { store, ledger } = buildStore();

    await store.writeBatch([RECORD], BATCH_CONTEXT);

    expect(ledger.rows[0]).toMatchObject({
      tenantId: "project-1",
      budgetId: "budget-project",
      virtualKeyId: "vk-1",
      gatewayRequestId: "grq_01H",
      amountUsd: "0.0012500000",
      tokensInput: 100,
      tokensOutput: 50,
      model: "gpt-5-mini",
      status: "SUCCESS",
      durationMs: 2000,
      occurredAt: new Date(1_700_000_000_500),
    });
  });

  it("resolves the project, its keys and their budgets once for the whole window, not once per request", async () => {
    const { store, prisma, resolveForRequest } = buildStore();

    await store.writeBatch(requests("grq_A", "grq_B", "grq_C"), BATCH_CONTEXT);

    expect(prisma.project.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.virtualKey.findMany).toHaveBeenCalledTimes(1);
    expect(resolveForRequest).toHaveBeenCalledTimes(1);
  });

  describe("given the same events are re-derived by a replay", () => {
    it("leaves the budget charged exactly what it was charged the first time", async () => {
      const { store, ledger } = buildStore();
      const window = requests("grq_A", "grq_B", "grq_C");

      await store.writeBatch(window, BATCH_CONTEXT);
      const spendAfterLive = ledger.spendFor("budget-project");
      await store.writeBatch(window, BATCH_CONTEXT);

      expect(ledger.spendFor("budget-project")).toBe(spendAfterLive);
      expect(ledger.rows).toHaveLength(3);
    });

    it("charges a request id repeated inside one batch only once", async () => {
      const { store, ledger } = buildStore();

      await store.writeBatch(requests("grq_A", "grq_A"), BATCH_CONTEXT);

      expect(ledger.rows).toHaveLength(1);
    });

    it("notifies the gateway only about the debits it actually repaired", async () => {
      const { store, appendChangeEvent } = buildStore();

      await store.writeBatch(requests("grq_A", "grq_B"), BATCH_CONTEXT);
      appendChangeEvent.mockClear();
      await store.writeBatch(
        requests("grq_A", "grq_B", "grq_lost"),
        BATCH_CONTEXT,
      );

      expect(appendChangeEvent).toHaveBeenCalledTimes(1);
      expect(appendChangeEvent.mock.calls[0]![0]).toMatchObject({
        kind: "BUDGET_UPDATED",
        payload: { gatewayRequestId: "grq_lost" },
      });
    });
  });

  describe("given ClickHouse rejects the write", () => {
    it("reports the failure so the window is retried rather than lost", async () => {
      const { store, ledger } = buildStore();
      ledger.insertDebits.mockRejectedValueOnce(new Error("CH unavailable"));

      await expect(
        store.writeBatch(requests("grq_A"), BATCH_CONTEXT),
      ).rejects.toThrow("CH unavailable");
    });
  });

  describe("given the budget lookup fails", () => {
    it("reports the failure rather than silently charging nothing", async () => {
      const { store, resolveForRequest } = buildStore();
      resolveForRequest.mockRejectedValue(new Error("PG down"));

      await expect(store.writeBatch([RECORD], BATCH_CONTEXT)).rejects.toThrow(
        "PG down",
      );
    });
  });

  describe("given the gateway cannot be notified", () => {
    it("keeps the debit — the ledger row is already committed", async () => {
      const { store, ledger } = buildStore({
        appendChangeEvent: vi.fn().mockRejectedValue(new Error("PG down")),
      });

      await expect(
        store.writeBatch([RECORD], BATCH_CONTEXT),
      ).resolves.toBeUndefined();
      expect(ledger.rows).toHaveLength(1);
    });
  });

  describe("given nothing can be charged", () => {
    it("writes nothing when the key no longer exists", async () => {
      const { store, ledger } = buildStore({ vk: null });

      await store.writeBatch([RECORD], BATCH_CONTEXT);

      expect(ledger.insertDebits).not.toHaveBeenCalled();
    });

    it("writes nothing when no budget covers the request", async () => {
      const { store, ledger, appendChangeEvent } = buildStore({ budgets: [] });

      await store.writeBatch([RECORD], BATCH_CONTEXT);

      expect(ledger.insertDebits).not.toHaveBeenCalled();
      expect(appendChangeEvent).not.toHaveBeenCalled();
    });
  });

  describe("given a key scoped to a principal", () => {
    it("resolves principal-scoped budgets from the key's owner", async () => {
      const { store, resolveForRequest } = buildStore({
        vk: { ...VK_SCOPED_AT_PROJECT_1, principalUserId: "user-9" },
      });

      await store.writeBatch([RECORD], BATCH_CONTEXT);

      expect(resolveForRequest).toHaveBeenCalledWith({
        organizationId: "org-1",
        teamId: "team-1",
        projectId: "project-1",
        virtualKeyId: "vk-1",
        principalUserId: "user-9",
      });
    });
  });
});
