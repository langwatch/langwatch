/**
 * Unit tests for the reportUsageForMonth command handler.
 * @see specs/licensing/billing-meter-dispatch.feature
 */

import type { ReportUsageForMonthCommandData } from "@langwatch/enterprise-billing-contract";
import type { Command } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockOrganizations,
  mockBillingCheckpoints,
  mockReportUsageDelta,
  mockSelfDispatch,
  mockCaptureException,
  mockQueryBillableEventsTotal,
  mockQueryInstantEvalSpendTotal,
  mockLogger,
} = vi.hoisted(() => {
  const reportUsageDeltaFn = vi.fn();
  const selfDispatchFn = vi.fn();
  const captureExceptionFn = vi.fn();
  const queryBillableEventsTotalFn = vi.fn();
  const queryInstantEvalSpendTotalFn = vi.fn();

  const createMockLogger = (): Record<string, unknown> => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  });

  // One instance, not one per `createLogger` call: the severity a skip is
  // reported at is the whole point of these tests, and it is only observable
  // if the handler's logger is the one they can read.
  const loggerInstance = createMockLogger();

  const organizationsPort = {
    getOrganizationForBilling: vi.fn(),
  };

  const billingCheckpointsPort = {
    findCheckpoint: vi.fn(),
    writeIntent: vi.fn(),
    confirm: vi.fn(),
    clearPendingAndIncrementFailures: vi.fn(),
    incrementFailures: vi.fn(),
  };

  return {
    mockOrganizations: organizationsPort,
    mockBillingCheckpoints: billingCheckpointsPort,
    mockReportUsageDelta: reportUsageDeltaFn,
    mockSelfDispatch: selfDispatchFn,
    mockCaptureException: captureExceptionFn,
    mockQueryBillableEventsTotal: queryBillableEventsTotalFn,
    mockQueryInstantEvalSpendTotal: queryInstantEvalSpendTotalFn,
    mockLogger: loggerInstance,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@langwatch/observability", () => ({
  createLogger: vi.fn(() => mockLogger),
}));

/**
 * A cache that never hits, so no test sees another test's cached org read.
 * The real one is Redis-backed and shared across pods; the command only
 * requires that a miss falls through to the organization read.
 */
const missingOrganizationCache = {
  find: async () => undefined,
  set: async () => {},
};

/** Collects what the handler reports; the real reporter forwards to PostHog. */
const errorReporter = { capture: mockCaptureException };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCommand(
  organizationId = "org-1",
  billingMonth = "2026-02",
): Command<ReportUsageForMonthCommandData> {
  return {
    tenantId: createTenantId(organizationId),
    aggregateId: organizationId,
    type: "lw.billing_report.report_usage_for_month" as any,
    data: {
      organizationId,
      billingMonth,
      tenantId: organizationId,
      occurredAt: Date.now(),
    },
  };
}

function usageBilledOrg({
  id = "org-1",
  stripeCustomerId = "cus_123",
  hasSubscription = true,
}: {
  id?: string;
  stripeCustomerId?: string | null;
  hasSubscription?: boolean;
} = {}) {
  return {
    outcome: "usage_billed" as const,
    organization: {
      id,
      stripeCustomerId,
      subscriptions: hasSubscription ? [{ id: "sub-1" }] : [],
    },
  };
}

async function createHandler() {
  const { ReportUsageForMonthCommandHandler } =
    await import("../report-usage-for-month.commands.ts");

  return new ReportUsageForMonthCommandHandler({
    organizations: mockOrganizations as any,
    billingCheckpoints: mockBillingCheckpoints as any,
    getUsageReportingService: () => ({
      reportUsageDelta: mockReportUsageDelta,
      reportUsageSet: vi.fn(),
      getUsageSummary: vi.fn(),
    }),
    queryBillableEventsTotal: mockQueryBillableEventsTotal,
    queryInstantEvalSpendTotal: mockQueryInstantEvalSpendTotal,
    selfDispatch: mockSelfDispatch,
    organizationCache: missingOrganizationCache,
    errorReporter: errorReporter as any,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReportUsageForMonthCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // No spend ledger unless a test says otherwise, so the Instant Evals
    // meter stays out of the way of every assertion about the events one.
    mockQueryInstantEvalSpendTotal.mockResolvedValue({ outcome: "unavailable" });
  });

  // ========================================================================
  // Skip conditions
  // ========================================================================

  describe("given org not found", () => {
    it("returns empty events without reporting", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue({
        outcome: "not_found",
      });
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });

    /** @scenario "A dispatch naming an organization that does not exist is a warning" */
    it("warns, because a dispatch naming an absent organization is an anomaly", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue({
        outcome: "not_found",
      });
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockLogger.debug).not.toHaveBeenCalled();
    });
  });

  describe("given org is not on usage-based pricing", () => {
    it("returns empty events without reporting", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue({
        outcome: "not_usage_billed",
      });
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });

    /** @scenario "An organization that does not buy usage is skipped quietly" */
    it("logs at debug, not warn, because every free and legacy plan lands here every cycle", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue({
        outcome: "not_usage_billed",
      });
      const handler = await createHandler();

      await handler.handle(makeCommand());

      // The regression this file exists to hold: the old handler could not
      // tell this case from a missing organization, so it warned on both and
      // the routine one recurred forever.
      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledTimes(1);
    });
  });

  describe("given org has no stripeCustomerId", () => {
    it("returns empty events without reporting", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg({ stripeCustomerId: null }),
      );
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given org has no active subscription", () => {
    it("returns empty events without reporting", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg({ hasSubscription: false }),
      );
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given ClickHouse not available", () => {
    it("returns empty events without reporting", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      mockQueryBillableEventsTotal.mockResolvedValue({ outcome: "unavailable" });
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });
  });

  describe("given delta is zero", () => {
    it("returns empty events without reporting", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      mockQueryBillableEventsTotal.mockResolvedValue({ outcome: "counted", total: 100 });
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Happy path
  // ========================================================================

  describe("given org with billable events and active subscription", () => {
    /** @scenario "Report metered usage through an injected provider" */
    it("reports delta, updates checkpoint, and self-dispatches", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      mockQueryBillableEventsTotal.mockResolvedValue({ outcome: "counted", total: 150 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockBillingCheckpoints.writeIntent.mockResolvedValue(undefined);
      mockBillingCheckpoints.confirm.mockResolvedValue(undefined);
      mockSelfDispatch.mockResolvedValue(undefined);
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);

      // Reports delta of 50
      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeCustomerId: "cus_123",
          events: expect.arrayContaining([expect.objectContaining({ value: 50 })]),
        }),
      );

      // Phase 1: writes pending intent
      expect(mockBillingCheckpoints.writeIntent).toHaveBeenCalledWith({
        meter: "langwatch_billable_events",
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 100,
        pendingReportedTotal: 150,
      });

      // Phase 2: confirms checkpoint
      expect(mockBillingCheckpoints.confirm).toHaveBeenCalledWith({
        meter: "langwatch_billable_events",
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 150,
      });

      // Self-dispatch fires
      expect(mockSelfDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-1" }),
      );
    });
  });

  describe("given both meters have something to report", () => {
    /** @scenario "The Instant Eval meter keeps its own checkpoint" */
    it("reports each on its own meter, checkpoint and identifier", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      mockQueryBillableEventsTotal.mockResolvedValue({ outcome: "counted", total: 150 });
      mockQueryInstantEvalSpendTotal.mockResolvedValue({ outcome: "counted", total: 12_345 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      // The events meter carries its count; the Instant Evals one carries the
      // month's dollars to four places, not its meter units.
      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [
            expect.objectContaining({
              eventName: "langwatch_billable_events",
              identifier: "org-1:2026-02:from:0:to:150",
              value: 150,
            }),
          ],
        }),
      );
      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [
            expect.objectContaining({
              eventName: "langwatch_instant_eval_usd",
              identifier: "org-1:2026-02:langwatch_instant_eval_usd:from:0:to:12345",
              value: 1.2345,
            }),
          ],
        }),
      );
      expect(mockBillingCheckpoints.confirm).toHaveBeenCalledWith({
        meter: "langwatch_instant_eval_usd",
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 12_345,
      });
    });
  });

  describe("given the events meter throws before Stripe is reached", () => {
    /** @scenario "The Instant Eval meter keeps its own checkpoint" */
    it("still reports the Instant Evals meter, and owes another tick", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      mockQueryBillableEventsTotal.mockRejectedValue(new Error("ClickHouse is down"));
      mockQueryInstantEvalSpendTotal.mockResolvedValue({ outcome: "counted", total: 20 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [expect.objectContaining({ eventName: "langwatch_instant_eval_usd" })],
        }),
      );
      expect(mockSelfDispatch).toHaveBeenCalled();
    });
  });

  describe("given first run for new org (no checkpoint)", () => {
    it("creates checkpoint at reported total", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      mockQueryBillableEventsTotal.mockResolvedValue({ outcome: "counted", total: 50 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockBillingCheckpoints.writeIntent.mockResolvedValue(undefined);
      mockBillingCheckpoints.confirm.mockResolvedValue(undefined);
      mockSelfDispatch.mockResolvedValue(undefined);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      // Reports full 50 (lastReportedTotal defaults to 0)
      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: expect.arrayContaining([expect.objectContaining({ value: 50 })]),
        }),
      );

      // Phase 2: confirms checkpoint at 50
      expect(mockBillingCheckpoints.confirm).toHaveBeenCalledWith({
        meter: "langwatch_billable_events",
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 50,
      });
    });
  });

  // ========================================================================
  // Crash recovery (two-phase checkpoint)
  // ========================================================================

  describe("given pending checkpoint (crash recovery)", () => {
    /** @scenario "Report metered usage through an injected provider" */
    it("uses pending value with same idempotency key", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: 200,
        consecutiveFailures: 0,
      });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockBillingCheckpoints.confirm.mockResolvedValue(undefined);
      mockSelfDispatch.mockResolvedValue(undefined);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      // Does NOT query ClickHouse; uses pending value directly
      expect(mockQueryBillableEventsTotal).not.toHaveBeenCalled();

      // Reports delta of 100 (200 - 100)
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

  // ========================================================================
  // Error handling — never throws
  // ========================================================================

  describe("given permanent Stripe rejection", () => {
    /** @scenario "Report metered usage through an injected provider" */
    it("clears pending, increments failures, does NOT self-dispatch", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      mockQueryBillableEventsTotal.mockResolvedValue({ outcome: "counted", total: 150 });
      mockReportUsageDelta.mockResolvedValue([{ reported: false, error: "meter_event_invalid" }]);
      mockBillingCheckpoints.writeIntent.mockResolvedValue(undefined);
      mockBillingCheckpoints.clearPendingAndIncrementFailures.mockResolvedValue(undefined);
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      // Never throws — returns empty events
      expect(result).toEqual([]);

      // No self-dispatch on permanent rejection
      expect(mockSelfDispatch).not.toHaveBeenCalled();

      // pendingReportedTotal cleared, consecutiveFailures incremented
      expect(mockBillingCheckpoints.clearPendingAndIncrementFailures).toHaveBeenCalledWith({
        meter: "langwatch_billable_events",
        organizationId: "org-1",
        billingMonth: "2026-02",
        consecutiveFailures: 1,
      });

      // Error captured
      expect(mockCaptureException).toHaveBeenCalled();
    });
  });

  describe("given transient Stripe error", () => {
    it("catches error, increments failures, and self-dispatches for retry", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue({
        lastReportedTotal: 0,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      mockQueryBillableEventsTotal.mockResolvedValue({ outcome: "counted", total: 10 });
      mockBillingCheckpoints.writeIntent.mockResolvedValue(undefined);
      mockReportUsageDelta.mockRejectedValue(new Error("Stripe rate limit"));
      mockBillingCheckpoints.incrementFailures.mockResolvedValue(undefined);
      mockSelfDispatch.mockResolvedValue(undefined);
      const handler = await createHandler();

      // Never throws — handler catches all errors
      const result = await handler.handle(makeCommand());
      expect(result).toEqual([]);

      // Self-dispatch fires for convergence loop
      expect(mockSelfDispatch).toHaveBeenCalled();

      // consecutiveFailures incremented
      expect(mockBillingCheckpoints.incrementFailures).toHaveBeenCalledWith({
        meter: "langwatch_billable_events",
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 0,
        pendingReportedTotal: 10,
        consecutiveFailures: 1,
      });
    });
  });

  describe("given unexpected error in skip conditions", () => {
    it("catches error and returns empty events", async () => {
      mockOrganizations.getOrganizationForBilling.mockRejectedValue(new Error("database offline"));
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockCaptureException).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Circuit-breaker
  // ========================================================================

  describe("given 5 consecutive failures (circuit-breaker threshold)", () => {
    it("does NOT self-dispatch and logs alarm", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 5,
      });
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      // No ClickHouse query, no Stripe call, no self-dispatch
      expect(mockQueryBillableEventsTotal).not.toHaveBeenCalled();
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });
  });

  describe("given circuit-breaker reset after successful report", () => {
    it("resets consecutiveFailures to 0 on success", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 3,
      });
      mockQueryBillableEventsTotal.mockResolvedValue({ outcome: "counted", total: 200 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockBillingCheckpoints.writeIntent.mockResolvedValue(undefined);
      mockBillingCheckpoints.confirm.mockResolvedValue(undefined);
      mockSelfDispatch.mockResolvedValue(undefined);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      // Phase 2 confirms with reset counter
      expect(mockBillingCheckpoints.confirm).toHaveBeenCalledWith({
        meter: "langwatch_billable_events",
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 200,
      });
    });
  });

  // ========================================================================
  // Static properties
  // ========================================================================

  describe("when checking its static properties", () => {
    it("exposes schema, getAggregateId, and getSpanAttributes", async () => {
      const { ReportUsageForMonthCommandHandler: ReportUsageForMonthCommand } =
        await import("../report-usage-for-month.commands.ts");

      expect(ReportUsageForMonthCommand.schema.type).toBe(
        "lw.billing_report.report_usage_for_month",
      );

      const payload = {
        organizationId: "org-1",
        billingMonth: "2026-02",
        tenantId: "org-1",
        occurredAt: Date.now(),
      };

      expect(ReportUsageForMonthCommand.getAggregateId(payload)).toBe("org-1");
      expect(ReportUsageForMonthCommand.getSpanAttributes(payload)).toEqual({
        "payload.organizationId": "org-1",
        "payload.billingMonth": "2026-02",
      });
    });
  });
});
