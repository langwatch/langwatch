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
  mockQueryInstantEvalSpendTotal,
  mockConnectedUsageCeiling,
  mockLogger,
} = vi.hoisted(() => {
  const reportUsageDeltaFn = vi.fn();
  const selfDispatchFn = vi.fn();
  const captureExceptionFn = vi.fn();
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

  const connectedUsageCeilingFn = vi.fn(async () => null);

  const billingCheckpointsPort = {
    findCheckpoint: vi.fn(),
    writeIntent: vi.fn(),
    recordCountedEvent: vi.fn(),
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
    mockQueryInstantEvalSpendTotal: queryInstantEvalSpendTotalFn,
    mockConnectedUsageCeiling: connectedUsageCeilingFn,
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

/** The month total as month_counted carries it; unset, the events meter has none. */
let countedTotal: number | undefined;
/** The month_counted event id the command carries; unset, no cursor applies. */
let countedEventId: string | undefined;

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
      billableEvents: countedTotal,
      countedEventId,
    },
  };
}

/**
 * The month before this one, and when it ended. A connected customer's event is
 * dated at the end of the month it covers, which the meter only accepts inside
 * its own age window — the previous month is always inside it.
 */
function previousBillingMonth(): [string, number] {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const previous = new Date(start);
  previous.setUTCMonth(previous.getUTCMonth() - 1);

  return [
    `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`,
    start,
  ];
}

function usageBilledOrg({
  id = "org-1",
  stripeCustomerId = "cus_123",
  hasSubscription = true,
  contract = "cloud" as const,
}: {
  id?: string;
  stripeCustomerId?: string | null;
  hasSubscription?: boolean;
  contract?: "cloud" | "connected";
} = {}) {
  return {
    outcome: "usage_billed" as const,
    organization: {
      id,
      stripeCustomerId,
      subscriptions: hasSubscription ? [{ id: "sub-1" }] : [],
      contract,
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
    queryInstantEvalSpendTotal: mockQueryInstantEvalSpendTotal,
    selfDispatch: mockSelfDispatch,
    organizationCache: missingOrganizationCache,
    errorReporter: errorReporter as any,
    connectedUsageCeiling: mockConnectedUsageCeiling,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReportUsageForMonthCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countedTotal = undefined;
    countedEventId = undefined;
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

  describe("given a command with no counted total", () => {
    it("returns empty events without reporting", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      countedTotal = undefined;
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });
  });

  describe("given delta is zero", () => {
    /** @scenario Reporting the same usage twice does not double it */
    it("returns empty events without reporting", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      countedTotal = 100;
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given the month's total was corrected below the checkpoint", () => {
    /**
     * @scenario "Billing's monthly report sends a lower corrected total as a negative meter event"
     * @scenario "A lower corrected total is applied as an explicit adjustment"
     */
    it("sends the difference as a negative meter event and lowers the checkpoint", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue({
        lastReportedTotal: 5000,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      countedTotal = 4500;
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [
            expect.objectContaining({
              value: -500,
              identifier: "org-1:2026-02:from:5000:to:4500",
            }),
          ],
        }),
      );
      expect(mockBillingCheckpoints.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ meter: "langwatch_billable_events", lastReportedTotal: 4500 }),
      );
    });

    /**
     * @scenario "A redelivered downward correction is applied once"
     * @scenario "A redelivered month_counted event applies no second adjustment"
     */
    it("sends nothing more once the checkpoint holds the corrected total", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue({
        lastReportedTotal: 4500,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      countedTotal = 4500;
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });

    /** @scenario "A redelivered downward correction is applied once" */
    it("replays a crash-interrupted correction under the same Stripe identifier", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue({
        lastReportedTotal: 5000,
        pendingReportedTotal: 4500,
        consecutiveFailures: 0,
      });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [
            expect.objectContaining({
              value: -500,
              identifier: "org-1:2026-02:from:5000:to:4500",
            }),
          ],
        }),
      );
    });
  });

  describe("given month_counted events ordered by their k-sortable ids", () => {
    /** @scenario "An older month_counted arriving after a newer one changes nothing" */
    it("ignores a count whose event id is not newer than the applied one", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue({
        lastReportedTotal: 5000,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
        lastCountedEventId: "01K2000000000000000000000B",
      });
      countedTotal = 4500;
      countedEventId = "01K2000000000000000000000A";
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockBillingCheckpoints.writeIntent).not.toHaveBeenCalled();
      expect(mockBillingCheckpoints.recordCountedEvent).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });

    it("records a newer count's id even when its total needs no report", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue({
        lastReportedTotal: 5000,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
        lastCountedEventId: "01K2000000000000000000000A",
      });
      countedTotal = 5000;
      countedEventId = "01K2000000000000000000000B";
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockBillingCheckpoints.recordCountedEvent).toHaveBeenCalledWith(
        expect.objectContaining({ countedEventId: "01K2000000000000000000000B" }),
      );
    });

    /** @scenario "A retry does not overwrite a newer pending total" */
    it("writes the intent with the event id and retries under that same id", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
        lastCountedEventId: "01K2000000000000000000000A",
      });
      countedTotal = 150;
      countedEventId = "01K2000000000000000000000B";
      mockReportUsageDelta.mockRejectedValue(new Error("rate limited"));
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockBillingCheckpoints.writeIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          pendingReportedTotal: 150,
          countedEventId: "01K2000000000000000000000B",
        }),
      );
      expect(mockSelfDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          billableEvents: 150,
          countedEventId: "01K2000000000000000000000B",
        }),
      );
    });

    it("resumes an interrupted report from its pending total under the same identifier", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: 150,
        consecutiveFailures: 1,
        lastCountedEventId: "01K2000000000000000000000B",
      });
      countedTotal = 150;
      countedEventId = "01K2000000000000000000000B";
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [
            expect.objectContaining({ value: 50, identifier: "org-1:2026-02:from:100:to:150" }),
          ],
        }),
      );
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
      countedTotal = 150;
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
      countedTotal = 150;
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
      mockBillingCheckpoints.findCheckpoint.mockRejectedValueOnce(new Error("Postgres is down"));
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
      countedTotal = 50;
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

      // Uses the pending value, not the command's total
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
      countedTotal = 150;
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
      countedTotal = 10;
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
      // No Stripe call, no self-dispatch
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
      countedTotal = 200;
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
  // ========================================================================
  // A connected self-hosted customer (ADR-156 section 7)
  // ========================================================================

  describe("given a connected self-hosted customer", () => {
    const connected = () => usageBilledOrg({ contract: "connected" });

    function arrange({ measured, ceiling }: { measured: number; ceiling: number | null }) {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(connected());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue({
        lastReportedTotal: 0,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      countedTotal = 0;
      mockQueryInstantEvalSpendTotal.mockResolvedValue({ outcome: "counted", total: measured });
      mockConnectedUsageCeiling.mockResolvedValue(ceiling as never);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockBillingCheckpoints.writeIntent.mockResolvedValue(undefined);
      mockBillingCheckpoints.confirm.mockResolvedValue(undefined);
      mockSelfDispatch.mockResolvedValue(undefined);
    }

    function hostedUsageEvent(): { value: number; timestamp: number } | undefined {
      const calls = mockReportUsageDelta.mock.calls as [
        { events: { eventName: string; value: number; timestamp: number }[] },
      ][];
      const hosted = calls.find(
        ([argument]) => argument.events[0]?.eventName !== "langwatch_billable_events",
      );

      return hosted?.[0].events[0];
    }

    /** @scenario Usage past the prepaid commit never reaches the invoice */
    it("clamps hosted usage that ran past what the contract agreed", async () => {
      arrange({ measured: 120_000, ceiling: 100_000 });
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(hostedUsageEvent()?.value).toBe(10);
    });

    /** @scenario Hosted usage of a connected customer reaches its metered subscription */
    it("reports the measured total when it stayed inside the contract", async () => {
      arrange({ measured: 90_000, ceiling: 100_000 });
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(hostedUsageEvent()?.value).toBe(9);
    });

    it("dates the event at the end of the month, because the quarter is still open", async () => {
      arrange({ measured: 90_000, ceiling: null });
      const [billingMonth, monthEndMs] = previousBillingMonth();
      const handler = await createHandler();

      await handler.handle(makeCommand("org-1", billingMonth));

      expect(hostedUsageEvent()?.timestamp).toBe(Math.floor(monthEndMs / 1000));
    });

    /** @scenario Usage older than the meter accepts is not sent with a stale timestamp */
    it("falls back to the time of reporting for a month older than the meter accepts", async () => {
      arrange({ measured: 90_000, ceiling: null });
      const before = Math.floor(Date.now() / 1000);
      const handler = await createHandler();

      await handler.handle(makeCommand("org-1", "2020-02"));

      expect(hostedUsageEvent()?.timestamp).toBeGreaterThanOrEqual(before);
      expect(hostedUsageEvent()?.value).toBe(9);
    });

    it("never asks for a ceiling on the events meter, which no contract caps", async () => {
      arrange({ measured: 90_000, ceiling: 100_000 });
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockConnectedUsageCeiling).toHaveBeenCalledTimes(1);
    });
  });
});
