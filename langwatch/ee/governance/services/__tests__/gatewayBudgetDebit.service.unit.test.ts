/**
 * Unit tests for the decisions the `gatewayBudgetDebits` store no longer
 * makes: which budgets a gateway request may move, and whether it may move
 * them at all.
 *
 * The batch path exists for replay, so the property that matters most is that
 * it decides IDENTICALLY to the single path — a rebuild that authorised
 * differently from the live write would repair the ledger into a state the
 * live path would never have produced. Each scenario below is therefore
 * asserted against both entry points from one table of inputs.
 */

import type { GatewayBudget } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayBudgetDebitRecord } from "../../projections/gatewayBudgetDebits.mapProjection";
import { GatewayBudgetDebitService } from "../gatewayBudgetDebit.service";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function budget(overrides: Partial<GatewayBudget> = {}): GatewayBudget {
  return {
    id: "budget-project",
    scopeType: "PROJECT",
    scopeId: "project-1",
    window: "MONTH",
    ...overrides,
  } as GatewayBudget;
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
  status: "SUCCESS",
  durationMs: 2000,
  occurredAt: new Date(1_700_000_000_500),
};

/**
 * A VK scoped at the project its spans land in — the ordinary shape, and the
 * one {@link isLegalSpanDestination} accepts without needing the governance
 * inbox.
 */
const VK_SCOPED_AT_PROJECT_1 = {
  id: "vk-1",
  organizationId: "org-1",
  principalUserId: null,
  scopes: [{ scopeId: "project-1" }],
};

function buildService({
  vk = VK_SCOPED_AT_PROJECT_1,
  project = {
    id: "project-1",
    teamId: "team-1",
    kind: "application",
    team: { organizationId: "org-1" },
  },
  budgets = [budget()],
}: {
  vk?: unknown;
  project?: unknown;
  budgets?: GatewayBudget[];
} = {}) {
  const applicableForRequest = vi.fn().mockResolvedValue(budgets);
  const service = new GatewayBudgetDebitService({
    prisma: {
      virtualKey: {
        findUnique: vi.fn().mockResolvedValue(vk),
        findMany: vi.fn().mockResolvedValue(vk ? [vk] : []),
      },
      project: { findUnique: vi.fn().mockResolvedValue(project) },
    } as never,
    budgetRepository: { applicableForRequest } as never,
  });
  return { service, applicableForRequest };
}

/** Runs a case through both entry points so neither can drift from the other. */
async function resolveBothWays(
  service: GatewayBudgetDebitService,
  record: GatewayBudgetDebitRecord,
) {
  return {
    single: await service.resolve(record),
    batched: (await service.resolveMany([record]))[0] ?? null,
  };
}

describe("GatewayBudgetDebitService", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("given a request covered by budgets at several scopes", () => {
    it("shapes one ledger row per applicable budget", async () => {
      const { service } = buildService({
        budgets: [
          budget({
            id: "budget-org",
            scopeType: "ORGANIZATION",
            scopeId: "org-1",
          }),
          budget(),
        ],
      });

      const { single, batched } = await resolveBothWays(service, RECORD);

      expect(single?.rows.map((r) => r.budgetId)).toEqual([
        "budget-org",
        "budget-project",
      ]);
      expect(batched?.rows).toEqual(single?.rows);
    });

    it("carries the derived amount, tokens, model and business time onto every row", async () => {
      const { service } = buildService();

      const resolved = await service.resolve(RECORD);

      expect(resolved?.rows[0]).toMatchObject({
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
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        model: "gpt-5-mini",
        status: "SUCCESS",
        durationMs: 2000,
        occurredAt: new Date(1_700_000_000_500),
      });
    });
  });

  describe("given the key belongs to another organization", () => {
    it("refuses the debit on both paths, so a rebuild cannot authorise what the live write refused", async () => {
      const { service } = buildService({
        vk: { ...VK_SCOPED_AT_PROJECT_1, organizationId: "org-other" },
      });

      const { single, batched } = await resolveBothWays(service, RECORD);

      expect(single).toBeNull();
      expect(batched).toBeNull();
    });
  });

  /**
   * Every attribute the debit is derived from is customer-writable: the
   * gateway ships its spans through the public OTLP route with the trace
   * project's own API key, so nothing on the span proves it came from the
   * gateway. Where the span LANDED is not the payload's to choose, and it is
   * the only bound available — a VK's spans can only ever be exported to one
   * of its PROJECT scopes or the org's hidden governance inbox.
   */
  describe("given the span landed in a project the key never exports to", () => {
    it("refuses the debit, so one project's key cannot burn the org's budget through another's VK", async () => {
      const { service } = buildService({
        vk: { ...VK_SCOPED_AT_PROJECT_1, scopes: [{ scopeId: "project-9" }] },
      });

      const { single, batched } = await resolveBothWays(service, RECORD);

      expect(single).toBeNull();
      expect(batched).toBeNull();
    });

    it("never asks which budgets the forged request would have moved", async () => {
      const { service, applicableForRequest } = buildService({
        vk: { ...VK_SCOPED_AT_PROJECT_1, scopes: [] },
      });

      await resolveBothWays(service, RECORD);

      expect(applicableForRequest).not.toHaveBeenCalled();
    });
  });

  describe("given an org-scoped key whose spans route to the hidden governance project", () => {
    it("still debits, because that is where the bridge legitimately exports them", async () => {
      const { service } = buildService({
        vk: { ...VK_SCOPED_AT_PROJECT_1, scopes: [] },
        project: {
          id: "project-1",
          teamId: "team-1",
          kind: "internal_governance",
          team: { organizationId: "org-1" },
        },
      });

      const { single, batched } = await resolveBothWays(service, RECORD);

      expect(single?.rows).toHaveLength(1);
      expect(batched?.rows).toEqual(single?.rows);
    });
  });

  describe("given the key no longer exists", () => {
    it("resolves nothing to charge", async () => {
      const { service } = buildService({ vk: null });

      const { single, batched } = await resolveBothWays(service, RECORD);

      expect(single).toBeNull();
      expect(batched).toBeNull();
    });
  });

  describe("given the project has no team to resolve scopes from", () => {
    it("resolves nothing to charge", async () => {
      const { service } = buildService({ project: null });

      const { single, batched } = await resolveBothWays(service, RECORD);

      expect(single).toBeNull();
      expect(batched).toBeNull();
    });
  });

  describe("given no budget covers the request", () => {
    it("resolves nothing to charge", async () => {
      const { service } = buildService({ budgets: [] });

      const { single, batched } = await resolveBothWays(service, RECORD);

      expect(single).toBeNull();
      expect(batched).toBeNull();
    });
  });

  describe("given Postgres is unavailable", () => {
    it("reports the failure so the map job retries rather than charging nothing", async () => {
      const { service, applicableForRequest } = buildService();
      applicableForRequest.mockRejectedValue(new Error("PG down"));

      await expect(service.resolve(RECORD)).rejects.toThrow("PG down");
      await expect(service.resolveMany([RECORD])).rejects.toThrow("PG down");
    });
  });

  describe("given a replay hands over a window of requests for one tenant", () => {
    it("queries a key's budgets once however many requests used it", async () => {
      const { service, applicableForRequest } = buildService();

      const resolved = await service.resolveMany([
        { ...RECORD, gatewayRequestId: "grq_A" },
        { ...RECORD, gatewayRequestId: "grq_B" },
        { ...RECORD, gatewayRequestId: "grq_C" },
      ]);

      expect(resolved).toHaveLength(3);
      expect(applicableForRequest).toHaveBeenCalledTimes(1);
    });

    it("collapses a request id delivered twice to the one the ledger probe would have kept", async () => {
      const { service } = buildService();

      const resolved = await service.resolveMany([
        { ...RECORD, gatewayRequestId: "grq_A" },
        { ...RECORD, gatewayRequestId: "grq_A", amountUsd: "9.9900000000" },
      ]);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]?.amountUsd).toBe("0.0012500000");
    });
  });
});
