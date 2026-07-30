/**
 * Unit tests for the reportUsageForMonth handler: the two-phase checkpoint
 * protocol, the circuit-breaker, and the self-dispatch convergence loop.
 *
 * Mocks boundaries: OrganizationService, BillingCheckpointService,
 * ClickHouse (queryBillableEventsTotal), Stripe (UsageReportingService),
 * selfDispatch, and error capture.
 *
 * @see specs/licensing/billing-meter-dispatch.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockOrganizations,
  mockBillingCheckpoints,
  mockReportUsageDelta,
  mockSelfDispatch,
  mockCaptureException,
  mockQueryBillableEventsTotal,
  createMockLogger,
} = vi.hoisted(() => {
  const mockReportUsageDelta = vi.fn();
  const mockSelfDispatch = vi.fn();
  const mockCaptureException = vi.fn();
  const mockQueryBillableEventsTotal = vi.fn();

  const createMockLogger = () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  });

  const mockOrganizations = { getOrganizationForBilling: vi.fn() };

  const mockBillingCheckpoints = {
    getCheckpoint: vi.fn(),
    writeIntent: vi.fn(),
    confirm: vi.fn(),
    clearPendingAndIncrementFailures: vi.fn(),
    incrementFailures: vi.fn(),
  };

  return {
    mockOrganizations,
    mockBillingCheckpoints,
    mockReportUsageDelta,
    mockSelfDispatch,
    mockCaptureException,
    mockQueryBillableEventsTotal,
    createMockLogger,
  };
});

vi.mock("@langwatch/observability", () => ({
  createLogger: vi.fn(() => createMockLogger()),
}));

// Disable the org-level TtlCache so tests don't share cached org data across runs.
vi.mock("~/server/utils/ttlCache", () => ({
  TtlCache: class {
    async get() {
      return undefined;
    }
    async set() {
      return;
    }
    async delete() {
      return;
    }
  },
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: mockCaptureException,
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
  withScope: vi.fn((cb: (scope: Record<string, unknown>) => void) => {
    cb({ setTag: vi.fn(), setExtra: vi.fn() });
  }),
}));

import type { ReportUsageForMonthData } from "../reportUsageForMonth";
import { reportUsageForMonth } from "../reportUsageForMonth";

function makeData(
  organizationId = "org-1",
  billingMonth = "2026-02",
): ReportUsageForMonthData {
  return {
    organizationId,
    billingMonth,
    tenantId: organizationId,
    occurredAt: Date.now(),
  };
}

function makeOrg({
  stripeCustomerId = "cus_123",
  hasSubscription = true,
}: {
  stripeCustomerId?: string | null;
  hasSubscription?: boolean;
} = {}) {
  return {
    id: "org-1",
    stripeCustomerId,
    subscriptions: hasSubscription ? [{ id: "sub-1" }] : [],
  };
}

function makeDeps() {
  return {
    organizations: mockOrganizations,
    billingCheckpoints: mockBillingCheckpoints as any,
    getUsageReportingService: () => ({
      reportUsageDelta: mockReportUsageDelta,
      reportUsageSet: vi.fn(),
      getUsageSummary: vi.fn(),
    }),
    queryBillableEventsTotal: mockQueryBillableEventsTotal,
    selfDispatch: mockSelfDispatch,
  };
}

describe("reportUsageForMonth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given org not found", () => {
    it("does nothing", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(null);

      await reportUsageForMonth(makeData(), makeDeps());

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });
  });

  describe("given org has no stripeCustomerId", () => {
    it("does nothing", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        makeOrg({ stripeCustomerId: null }),
      );

      await reportUsageForMonth(makeData(), makeDeps());

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given org has no active subscription", () => {
    it("does nothing", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        makeOrg({ hasSubscription: false }),
      );

      await reportUsageForMonth(makeData(), makeDeps());

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given ClickHouse is not available", () => {
    it("does nothing", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(makeOrg());
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue(null);
      mockQueryBillableEventsTotal.mockResolvedValue(null);

      await reportUsageForMonth(makeData(), makeDeps());

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });
  });

  describe("given the delta is zero", () => {
    it("does nothing", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(makeOrg());
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      mockQueryBillableEventsTotal.mockResolvedValue(100);

      await reportUsageForMonth(makeData(), makeDeps());

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given an org with billable events and an active subscription", () => {
    it("reports the delta, updates the checkpoint, and self-dispatches", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(makeOrg());
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      mockQueryBillableEventsTotal.mockResolvedValue(150);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);

      await reportUsageForMonth(makeData(), makeDeps());

      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeCustomerId: "cus_123",
          events: expect.arrayContaining([
            expect.objectContaining({ value: 50 }),
          ]),
        }),
      );
      expect(mockBillingCheckpoints.writeIntent).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 100,
        pendingReportedTotal: 150,
      });
      expect(mockBillingCheckpoints.confirm).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 150,
      });
      expect(mockSelfDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-1" }),
      );
    });
  });

  describe("given a first run for a new org (no checkpoint)", () => {
    it("reports the full total and confirms at that total", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(makeOrg());
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue(null);
      mockQueryBillableEventsTotal.mockResolvedValue(50);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);

      await reportUsageForMonth(makeData(), makeDeps());

      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: expect.arrayContaining([
            expect.objectContaining({ value: 50 }),
          ]),
        }),
      );
      expect(mockBillingCheckpoints.confirm).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 50,
      });
    });
  });

  describe("given a pending checkpoint (crash recovery)", () => {
    it("uses the pending value directly, without re-querying ClickHouse", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(makeOrg());
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: 200,
        consecutiveFailures: 0,
      });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);

      await reportUsageForMonth(makeData(), makeDeps());

      expect(mockQueryBillableEventsTotal).not.toHaveBeenCalled();
      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: expect.arrayContaining([
            expect.objectContaining({
              value: 100,
              identifier: expect.stringContaining("from:100:to:200"),
            }),
          ]),
        }),
      );
    });
  });

  describe("given a permanent Stripe rejection", () => {
    it("clears pending, increments failures, and does not self-dispatch", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(makeOrg());
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      mockQueryBillableEventsTotal.mockResolvedValue(150);
      mockReportUsageDelta.mockResolvedValue([
        { reported: false, error: "meter_event_invalid" },
      ]);

      await reportUsageForMonth(makeData(), makeDeps());

      expect(mockSelfDispatch).not.toHaveBeenCalled();
      expect(
        mockBillingCheckpoints.clearPendingAndIncrementFailures,
      ).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        consecutiveFailures: 1,
      });
      expect(mockCaptureException).toHaveBeenCalled();
    });
  });

  describe("given a transient Stripe error", () => {
    it("increments failures and self-dispatches for retry, without throwing", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(makeOrg());
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue({
        lastReportedTotal: 0,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      mockQueryBillableEventsTotal.mockResolvedValue(10);
      mockReportUsageDelta.mockRejectedValue(new Error("Stripe rate limit"));

      await expect(
        reportUsageForMonth(makeData(), makeDeps()),
      ).resolves.toBeUndefined();

      expect(mockSelfDispatch).toHaveBeenCalled();
      expect(mockBillingCheckpoints.incrementFailures).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 0,
        pendingReportedTotal: 10,
        consecutiveFailures: 1,
      });
    });
  });

  describe("given an unexpected error resolving the organization", () => {
    it("catches it and captures the exception, without throwing", async () => {
      mockOrganizations.getOrganizationForBilling.mockRejectedValue(
        new Error("database offline"),
      );

      await expect(
        reportUsageForMonth(makeData(), makeDeps()),
      ).resolves.toBeUndefined();
      expect(mockCaptureException).toHaveBeenCalled();
    });
  });

  describe("given 5 consecutive failures (circuit-breaker threshold)", () => {
    // The bug this guards against: the pre-fix breaker returned early WITHOUT
    // ever attempting Stripe again, and `confirm()` — the only place
    // `consecutiveFailures` resets to 0 — is reachable only via a successful
    // Stripe call. Skipping the attempt outright therefore latches the
    // organization permanently: every future poke and every future sweep
    // tick would keep re-reading the same tripped checkpoint and giving up
    // again, forever, with no code path back to being invoiced. Both tests
    // below prove the escape: the attempt is never skipped.

    it("still attempts Stripe rather than silently giving up, and pauses only the immediate self-dispatch when it fails again", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(makeOrg());
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 5,
      });
      mockQueryBillableEventsTotal.mockResolvedValue(150);
      mockReportUsageDelta.mockRejectedValue(new Error("Stripe still down"));

      await reportUsageForMonth(makeData(), makeDeps());

      // The escape path: this attempt happened, it was not skipped.
      expect(mockQueryBillableEventsTotal).toHaveBeenCalled();
      expect(mockReportUsageDelta).toHaveBeenCalled();
      expect(mockBillingCheckpoints.incrementFailures).toHaveBeenCalledWith(
        expect.objectContaining({ consecutiveFailures: 6 }),
      );
      // Only the un-throttled immediate retry is paused, so a broken Stripe
      // cannot spin this in a tight loop — see the next test for how the org
      // still recovers via an independent trigger.
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });

    it("resets and un-trips the breaker the moment an independently-triggered attempt succeeds", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(makeOrg());
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 5,
      });
      mockQueryBillableEventsTotal.mockResolvedValue(150);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);

      // Simulates the next independent poke or sweep tick calling in fresh —
      // not a self-dispatch from the same call.
      await reportUsageForMonth(makeData(), makeDeps());

      expect(mockBillingCheckpoints.confirm).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 150,
      });
      // `confirm` (not `incrementFailures`) is what the checkpoint service
      // resets `consecutiveFailures` to 0 on — this organization is invoiced
      // again on the very next successful attempt, with no manual fix needed.
      expect(mockBillingCheckpoints.incrementFailures).not.toHaveBeenCalled();
    });
  });

  describe("given a successful report after prior failures", () => {
    it("resets consecutiveFailures to 0", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(makeOrg());
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 3,
      });
      mockQueryBillableEventsTotal.mockResolvedValue(200);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);

      await reportUsageForMonth(makeData(), makeDeps());

      expect(mockBillingCheckpoints.confirm).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 200,
      });
    });
  });
});
