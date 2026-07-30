/**
 * Unit tests for the ADR-075 Class C (retired; ground now ADR-098)
 * `gatewayBudgetDebits` write side.
 *
 * The properties that matter here are the two the reactor could not offer:
 *
 *  1. A failed write is REPORTED, not swallowed. The reactor wrapped its whole
 *     body in a try/catch, so a ClickHouse blip deleted spend that had already
 *     been incurred and nothing retried it. The store must throw.
 *  2. Re-deriving the same events does not charge twice. Replay re-runs the
 *     projection over history; the ledger it lands in aggregates at INSERT time
 *     in a materialised view that does not collapse, so "written once" has to
 *     be enforced on the write path, not left to a merge.
 *
 * The ClickHouse repository is modelled as a fake that reproduces the real
 * probe-then-insert contract, so the double-charge test observes what the
 * ledger would actually hold rather than how many times a mock was called.
 */

import { GatewayBudgetDebitService } from "@ee/governance/services/gatewayBudgetDebit.service";
import type { GatewayBudget } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BudgetDebitRow } from "~/server/gateway/budget.clickhouse.repository";
import type { ResolvedBudget } from "~/server/gateway/budgetResolution.service";
import type { GatewayBudgetDebitRecord } from "../gatewayBudgetDebits.mapProjection";
import { GatewayBudgetDebitsAppendStore } from "../gatewayBudgetDebits.store";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

/**
 * Stand-in for `gateway_budget_ledger_events` + its rollup: rows accumulate,
 * and a request id already present short-circuits the insert exactly as the
 * real repository's pre-insert probe does. `spend` is the number the
 * AggregatingMergeTree view would report — the one a budget is enforced on.
 */
class FakeLedger {
  readonly rows: BudgetDebitRow[] = [];

  insertDebit = vi.fn(
    async (rows: BudgetDebitRow[]): Promise<{ inserted: boolean }> => {
      if (rows.length === 0) return { inserted: false };
      const requestId = rows[0]!.gatewayRequestId;
      if (this.rows.some((r) => r.gatewayRequestId === requestId)) {
        return { inserted: false };
      }
      this.rows.push(...rows);
      return { inserted: true };
    },
  );

  /**
   * Batch form: one probe covering every request id in the call, rows for the
   * ids already present dropped, the rest written together — the contract the
   * real repository's `insertDebits` implements.
   */
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

const STORE_CONTEXT = {
  aggregateId: "trace-1",
  tenantId: "project-1" as never,
};

/**
 * The VK is scoped at the project its spans land in — the shape the debit
 * service requires before it will authorise a write, since a span landing
 * anywhere else was not exported by the gateway's trace bridge.
 */
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
  // Composed through the REAL service, so these scenarios still observe the
  // resolve → authorise → insert → notify path end to end after the split.
  const store = new GatewayBudgetDebitsAppendStore({
    debits: new GatewayBudgetDebitService({
      prisma: prisma as never,
      budgetRepository: { resolveForRequest } as never,
    }),
    budgetCHRepository: ledger as never,
    changeEvents: { append: appendChangeEvent } as never,
  });
  return { store, prisma, ledger, appendChangeEvent, resolveForRequest };
}

describe("GatewayBudgetDebitsAppendStore", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("given a gateway request covered by several budgets", () => {
    it("charges every applicable budget once", async () => {
      const { store, ledger } = buildStore({
        budgets: [
          budget({
            id: "budget-org",
            scopeType: "ORGANIZATION",
            scopeId: "org-1",
          }),
          budget({ id: "budget-team", scopeType: "TEAM", scopeId: "team-1" }),
          budget(),
        ],
      });

      await store.append(RECORD, STORE_CONTEXT);

      expect(ledger.rows).toHaveLength(3);
      expect(ledger.rows.map((r) => r.budgetId)).toEqual([
        "budget-org",
        "budget-team",
        "budget-project",
      ]);
    });

    it("carries the derived amount, tokens, model and business time onto every row", async () => {
      const { store, ledger } = buildStore();

      await store.append(RECORD, STORE_CONTEXT);

      expect(ledger.rows[0]).toMatchObject({
        tenantId: "project-1",
        budgetId: "budget-project",
        scope: "PROJECT",
        scopeId: "project-1",
        window: "MONTH",
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
  });

  describe("given the same events are derived again by a replay", () => {
    it("leaves the budget charged exactly what it was charged the first time", async () => {
      const ledger = new FakeLedger();
      const { store } = buildStore({ ledger });
      const requests: GatewayBudgetDebitRecord[] = [
        { ...RECORD, gatewayRequestId: "grq_A" },
        { ...RECORD, gatewayRequestId: "grq_B" },
        { ...RECORD, gatewayRequestId: "grq_C" },
      ];

      for (const request of requests) {
        await store.append(request, STORE_CONTEXT);
      }
      const spendAfterLive = ledger.spendFor("budget-project");

      // The replay: the projection re-derives the identical records from the
      // same events and hands them to the same store.
      for (const request of requests) {
        await store.append(request, STORE_CONTEXT);
      }

      expect(ledger.spendFor("budget-project")).toBe(spendAfterLive);
      expect(ledger.rows).toHaveLength(3);
    });

    it("does not re-notify the gateway about spend it already knows", async () => {
      const { store, appendChangeEvent } = buildStore();

      await store.append(RECORD, STORE_CONTEXT);
      await store.append(RECORD, STORE_CONTEXT);

      expect(appendChangeEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a replay finds a debit missing from the ledger", () => {
    it("writes it and tells the gateway spend moved", async () => {
      const { store, ledger, appendChangeEvent } = buildStore();

      await store.append(
        { ...RECORD, gatewayRequestId: "grq_lost" },
        STORE_CONTEXT,
      );

      expect(ledger.rows).toHaveLength(1);
      expect(appendChangeEvent).toHaveBeenCalledTimes(1);
      expect(appendChangeEvent.mock.calls[0]![0]).toMatchObject({
        organizationId: "org-1",
        projectId: "project-1",
        kind: "BUDGET_UPDATED",
        payload: {
          gatewayRequestId: "grq_lost",
          virtualKeyId: "vk-1",
          budgetIds: ["budget-project"],
        },
      });
    });
  });

  describe("given ClickHouse rejects the write", () => {
    it("reports the failure so the debit is retried rather than lost", async () => {
      const ledger = new FakeLedger();
      ledger.insertDebit.mockRejectedValueOnce(new Error("CH unavailable"));
      const { store } = buildStore({ ledger });

      await expect(store.append(RECORD, STORE_CONTEXT)).rejects.toThrow(
        "CH unavailable",
      );
    });
  });

  describe("given the budget lookup fails", () => {
    it("reports the failure rather than silently charging nothing", async () => {
      const { store, resolveForRequest } = buildStore();
      resolveForRequest.mockRejectedValue(new Error("PG down"));

      await expect(store.append(RECORD, STORE_CONTEXT)).rejects.toThrow(
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
        store.append(RECORD, STORE_CONTEXT),
      ).resolves.toBeUndefined();
      expect(ledger.rows).toHaveLength(1);
    });
  });

  describe("given nothing can be charged", () => {
    it("writes nothing when the key no longer exists", async () => {
      const { store, ledger } = buildStore({ vk: null });

      await store.append(RECORD, STORE_CONTEXT);

      expect(ledger.rows).toHaveLength(0);
      expect(ledger.insertDebit).not.toHaveBeenCalled();
    });

    it("writes nothing when the project has no team to resolve scopes from", async () => {
      const { store, ledger } = buildStore({ project: null });

      await store.append(RECORD, STORE_CONTEXT);

      expect(ledger.insertDebit).not.toHaveBeenCalled();
    });

    it("refuses to charge a key belonging to another organization", async () => {
      const { store, ledger } = buildStore({
        vk: { ...VK_SCOPED_AT_PROJECT_1, organizationId: "org-other" },
      });

      await store.append(RECORD, STORE_CONTEXT);

      expect(ledger.insertDebit).not.toHaveBeenCalled();
    });

    it("writes nothing when no budget covers the request", async () => {
      const { store, ledger, appendChangeEvent } = buildStore({ budgets: [] });

      await store.append(RECORD, STORE_CONTEXT);

      expect(ledger.insertDebit).not.toHaveBeenCalled();
      expect(appendChangeEvent).not.toHaveBeenCalled();
    });
  });

  describe("given a key scoped to a principal", () => {
    it("resolves principal-scoped budgets from the key's owner", async () => {
      const { store, resolveForRequest } = buildStore({
        vk: { ...VK_SCOPED_AT_PROJECT_1, principalUserId: "user-9" },
      });

      await store.append(RECORD, STORE_CONTEXT);

      expect(resolveForRequest).toHaveBeenCalledWith({
        organizationId: "org-1",
        teamId: "team-1",
        projectId: "project-1",
        virtualKeyId: "vk-1",
        principalUserId: "user-9",
      });
    });
  });

  describe("given a replay flushes a window of requests through bulkAppend", () => {
    const BULK_CONTEXT = { tenantId: "project-1" as never };

    function requests(...ids: string[]): GatewayBudgetDebitRecord[] {
      return ids.map((gatewayRequestId) => ({ ...RECORD, gatewayRequestId }));
    }

    it("charges every request in the window", async () => {
      const { store, ledger } = buildStore();

      await store.bulkAppend(requests("grq_A", "grq_B", "grq_C"), BULK_CONTEXT);

      expect(ledger.rows.map((r) => r.gatewayRequestId)).toEqual([
        "grq_A",
        "grq_B",
        "grq_C",
      ]);
    });

    it("resolves the project, its keys and their budgets once for the whole window, not once per request", async () => {
      const { store, prisma, resolveForRequest } = buildStore();

      await store.bulkAppend(requests("grq_A", "grq_B", "grq_C"), BULK_CONTEXT);

      expect(prisma.project.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.virtualKey.findMany).toHaveBeenCalledTimes(1);
      expect(resolveForRequest).toHaveBeenCalledTimes(1);
    });

    it("writes the whole window through one ledger call", async () => {
      const { store, ledger } = buildStore();

      await store.bulkAppend(requests("grq_A", "grq_B", "grq_C"), BULK_CONTEXT);

      expect(ledger.insertDebits).toHaveBeenCalledTimes(1);
      expect(ledger.insertDebit).not.toHaveBeenCalled();
    });

    it("leaves the budget charged exactly what it was charged live", async () => {
      const { store, ledger } = buildStore();
      const window = requests("grq_A", "grq_B", "grq_C");

      await store.bulkAppend(window, BULK_CONTEXT);
      const spendAfterLive = ledger.spendFor("budget-project");
      await store.bulkAppend(window, BULK_CONTEXT);

      expect(ledger.spendFor("budget-project")).toBe(spendAfterLive);
      expect(ledger.rows).toHaveLength(3);
    });

    it("charges a request id repeated inside one batch only once", async () => {
      const { store, ledger } = buildStore();

      await store.bulkAppend(requests("grq_A", "grq_A"), BULK_CONTEXT);

      expect(ledger.rows).toHaveLength(1);
    });

    it("notifies the gateway only about the debits it actually repaired", async () => {
      const { store, appendChangeEvent } = buildStore();

      await store.bulkAppend(requests("grq_A", "grq_B"), BULK_CONTEXT);
      appendChangeEvent.mockClear();
      await store.bulkAppend(
        requests("grq_A", "grq_B", "grq_lost"),
        BULK_CONTEXT,
      );

      expect(appendChangeEvent).toHaveBeenCalledTimes(1);
      expect(appendChangeEvent.mock.calls[0]![0]).toMatchObject({
        kind: "BUDGET_UPDATED",
        payload: { gatewayRequestId: "grq_lost" },
      });
    });

    it("reports a failed batch write so the window is retried rather than lost", async () => {
      const { store, ledger } = buildStore();
      ledger.insertDebits.mockRejectedValueOnce(new Error("CH unavailable"));

      await expect(
        store.bulkAppend(requests("grq_A"), BULK_CONTEXT),
      ).rejects.toThrow("CH unavailable");
    });

    it("writes nothing when no key in the window can be charged", async () => {
      const { store, ledger } = buildStore({ vk: null });

      await store.bulkAppend(requests("grq_A", "grq_B"), BULK_CONTEXT);

      expect(ledger.insertDebits).not.toHaveBeenCalled();
    });
  });
});
