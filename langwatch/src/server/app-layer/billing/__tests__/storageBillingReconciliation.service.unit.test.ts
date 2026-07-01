/**
 * @see specs/data-retention/storage-billing-reconciliation.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockError, createMockLogger } = vi.hoisted(() => {
  const mockError = vi.fn();
  const createMockLogger = () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: mockError,
    child: vi.fn(() => createMockLogger()),
  });
  return { mockError, createMockLogger };
});

vi.mock("~/utils/logger/server", () => ({
  createLogger: vi.fn(() => createMockLogger()),
}));

import { StorageBillingReconciliationService } from "../storageBillingReconciliation.service";

function makeService(
  overrides: Partial<{
    orgs: string[];
    reported: number;
    stripeTotal: number | null;
    stripeByOrg: Record<string, number | null>;
    reportedByOrg: Record<string, number>;
  }> = {},
) {
  const service = new StorageBillingReconciliationService({
    listReconcilableOrgs: vi.fn().mockResolvedValue(overrides.orgs ?? ["org-1"]),
    sumReportedMegabytes: vi.fn(async ({ organizationId }) =>
      overrides.reportedByOrg
        ? overrides.reportedByOrg[organizationId]!
        : (overrides.reported ?? 1000),
    ),
    fetchStripeMeterTotal: vi.fn(async ({ organizationId }) =>
      overrides.stripeByOrg
        ? overrides.stripeByOrg[organizationId]!
        : overrides.stripeTotal === undefined
          ? 1000
          : overrides.stripeTotal,
    ),
    toleranceRatio: 0.01,
  });
  return { service };
}

describe("StorageBillingReconciliationService", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("given recorded and Stripe totals match within tolerance", () => {
    /** @scenario Matching totals report no drift */
    it("logs no drift", async () => {
      const { service } = makeService({ reported: 1000, stripeTotal: 1005 });

      const result = await service.reconcile({ billingMonth: "2026-02" });

      expect(result.drifted).toBe(0);
      expect(result.checked).toBe(1);
      expect(mockError).not.toHaveBeenCalled();
    });
  });

  describe("given the totals diverge beyond tolerance", () => {
    /** @scenario Divergent totals are flagged as drift */
    it("logs a drift error", async () => {
      const { service } = makeService({ reported: 1000, stripeTotal: 2000 });

      const result = await service.reconcile({ billingMonth: "2026-02" });

      expect(result.drifted).toBe(1);
      expect(mockError).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-1", billingMonth: "2026-02" }),
        expect.stringContaining("DRIFT"),
      );
    });
  });

  describe("given Stripe's total is unavailable", () => {
    /** @scenario An unavailable Stripe total is skipped, never a false drift */
    it("counts it as unavailable and does not flag drift", async () => {
      const { service } = makeService({ reported: 1000, stripeTotal: null });

      const result = await service.reconcile({ billingMonth: "2026-02" });

      expect(result.unavailable).toBe(1);
      expect(result.checked).toBe(0);
      expect(mockError).not.toHaveBeenCalled();
    });
  });

  describe("given several organizations", () => {
    /** @scenario Each organization is reconciled independently */
    it("checks each and flags only the drifting one", async () => {
      const { service } = makeService({
        orgs: ["ok", "bad"],
        reportedByOrg: { ok: 1000, bad: 1000 },
        stripeByOrg: { ok: 1000, bad: 5000 },
      });

      const result = await service.reconcile({ billingMonth: "2026-02" });

      expect(result.checked).toBe(2);
      expect(result.drifted).toBe(1);
    });
  });
});
