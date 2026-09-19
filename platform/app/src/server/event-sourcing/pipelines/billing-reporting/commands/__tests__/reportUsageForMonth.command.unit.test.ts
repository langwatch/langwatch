/**
 * Unit tests for the reportUsageForMonth command handler.
 *
 * Mocks boundaries: OrganizationService, BillingCheckpointService,
 * ClickHouse (queryBillableEventsTotal), Stripe (UsageReportingService),
 * selfDispatch, and error capture.
 *
 * @see specs/licensing/billing-meter-dispatch.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command } from "../../../../";
import { createTenantId } from "../../../../domain/tenantId";
import type { ReportUsageForMonthCommandData } from "../../schemas/commands";

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
  const mockReportUsageDelta = vi.fn();
  const mockSelfDispatch = vi.fn();
  const mockCaptureException = vi.fn();
  const mockQueryBillableEventsTotal = vi.fn();
  const mockQueryInstantEvalSpendTotal = vi.fn();

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
  const mockLogger = createMockLogger();

  const mockOrganizations = {
    getOrganizationForBilling: vi.fn(),
  };

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
    mockQueryInstantEvalSpendTotal,
    mockLogger,
  };
});

/** The checkpoint key every expectation on the events meter carries. */
const EVENTS_METER = "langwatch_billable_events";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@langwatch/observability", () => ({
  createLogger: vi.fn(() => mockLogger),
}));

// Disable the org-level TtlCache so tests don't share cached org data across runs
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
  const { ReportUsageForMonthCommand } = await import(
    "../reportUsageForMonth.command"
  );

  return new ReportUsageForMonthCommand({
    organizations: mockOrganizations as any,
    billingCheckpoints: mockBillingCheckpoints as any,
    getUsageReportingService: () => ({
      reportUsageDelta: mockReportUsageDelta,
      reportUsageSet: vi.fn(),
      getUsageSummary: vi.fn(),
    }),
    queryBillableEventsTotal: mockQueryBillableEventsTotal,
    queryInstantEvalSpendTotal: mockQueryInstantEvalSpendTotal,
    isInstantEvalMeterProvisioned: () => isInstantEvalMeterProvisioned,
    selfDispatch: mockSelfDispatch,
  });
}

/** Whether the catalog maps the Instant Evals meter; cases flip it. */
let isInstantEvalMeterProvisioned = true;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReportUsageForMonthCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The Instant Evals meter is quiet unless a case says otherwise, so the
    // events meter's cases read exactly as they did with one meter.
    mockQueryInstantEvalSpendTotal.mockResolvedValue(0);
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
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg(),
      );
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue(null);
      mockQueryBillableEventsTotal.mockResolvedValue(null);
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      expect(result).toEqual([]);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });
  });

  describe("given delta is zero", () => {
    it("returns empty events without reporting", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg(),
      );
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      mockQueryBillableEventsTotal.mockResolvedValue(100);
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
    it("reports delta, updates checkpoint, and self-dispatches", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg(),
      );
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      mockQueryBillableEventsTotal.mockResolvedValue(150);
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
          events: expect.arrayContaining([
            expect.objectContaining({ value: 50 }),
          ]),
        }),
      );

      // Phase 1: writes pending intent
      expect(mockBillingCheckpoints.writeIntent).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        meter: EVENTS_METER,
        lastReportedTotal: 100,
        pendingReportedTotal: 150,
      });

      // Phase 2: confirms checkpoint
      expect(mockBillingCheckpoints.confirm).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        meter: EVENTS_METER,
        lastReportedTotal: 150,
      });

      // Self-dispatch fires
      expect(mockSelfDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-1" }),
      );
    });
  });

  describe("given first run for new org (no checkpoint)", () => {
    it("creates checkpoint at reported total", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg(),
      );
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue(null);
      mockQueryBillableEventsTotal.mockResolvedValue(50);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockBillingCheckpoints.writeIntent.mockResolvedValue(undefined);
      mockBillingCheckpoints.confirm.mockResolvedValue(undefined);
      mockSelfDispatch.mockResolvedValue(undefined);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      // Reports full 50 (lastReportedTotal defaults to 0)
      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: expect.arrayContaining([
            expect.objectContaining({ value: 50 }),
          ]),
        }),
      );

      // Phase 2: confirms checkpoint at 50
      expect(mockBillingCheckpoints.confirm).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        meter: EVENTS_METER,
        lastReportedTotal: 50,
      });
    });
  });

  // ========================================================================
  // Crash recovery (two-phase checkpoint)
  // ========================================================================

  describe("given pending checkpoint (crash recovery)", () => {
    it("uses pending value with same idempotency key", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg(),
      );
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue({
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
    it("clears pending, increments failures, does NOT self-dispatch", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg(),
      );
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      mockQueryBillableEventsTotal.mockResolvedValue(150);
      mockReportUsageDelta.mockResolvedValue([
        { reported: false, error: "meter_event_invalid" },
      ]);
      mockBillingCheckpoints.writeIntent.mockResolvedValue(undefined);
      mockBillingCheckpoints.clearPendingAndIncrementFailures.mockResolvedValue(
        undefined,
      );
      const handler = await createHandler();

      const result = await handler.handle(makeCommand());

      // Never throws — returns empty events
      expect(result).toEqual([]);

      // No self-dispatch on permanent rejection
      expect(mockSelfDispatch).not.toHaveBeenCalled();

      // pendingReportedTotal cleared, consecutiveFailures incremented
      expect(
        mockBillingCheckpoints.clearPendingAndIncrementFailures,
      ).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        meter: EVENTS_METER,
        consecutiveFailures: 1,
      });

      // Error captured
      expect(mockCaptureException).toHaveBeenCalled();
    });
  });

  describe("given transient Stripe error", () => {
    it("catches error, increments failures, and self-dispatches for retry", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg(),
      );
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue({
        lastReportedTotal: 0,
        pendingReportedTotal: null,
        consecutiveFailures: 0,
      });
      mockQueryBillableEventsTotal.mockResolvedValue(10);
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
        organizationId: "org-1",
        billingMonth: "2026-02",
        meter: EVENTS_METER,
        lastReportedTotal: 0,
        pendingReportedTotal: 10,
        consecutiveFailures: 1,
      });
    });
  });

  describe("given unexpected error in skip conditions", () => {
    it("catches error and returns empty events", async () => {
      mockOrganizations.getOrganizationForBilling.mockRejectedValue(
        new Error("database offline"),
      );
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
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg(),
      );
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue({
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
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg(),
      );
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue({
        lastReportedTotal: 100,
        pendingReportedTotal: null,
        consecutiveFailures: 3,
      });
      mockQueryBillableEventsTotal.mockResolvedValue(200);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockBillingCheckpoints.writeIntent.mockResolvedValue(undefined);
      mockBillingCheckpoints.confirm.mockResolvedValue(undefined);
      mockSelfDispatch.mockResolvedValue(undefined);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      // Phase 2 confirms with reset counter
      expect(mockBillingCheckpoints.confirm).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        meter: EVENTS_METER,
        lastReportedTotal: 200,
      });
    });
  });

  // ========================================================================
  // The Instant Evals meter
  // ========================================================================

  describe("given an organization with Instant Eval spend this month", () => {
    const INSTANT_EVAL_METER = "langwatch_instant_eval_usd";

    beforeEach(() => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg(),
      );
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue(null);
      mockQueryBillableEventsTotal.mockResolvedValue(0);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockBillingCheckpoints.writeIntent.mockResolvedValue(undefined);
      mockBillingCheckpoints.confirm.mockResolvedValue(undefined);
      mockSelfDispatch.mockResolvedValue(undefined);
    });

    /** @scenario "The meter is named langwatch_instant_eval_usd" */
    it("reports on the langwatch_instant_eval_usd meter", async () => {
      mockQueryInstantEvalSpendTotal.mockResolvedValue(123_456);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeCustomerId: "cus_123",
          events: [expect.objectContaining({ eventName: INSTANT_EVAL_METER })],
        }),
      );
    });

    /** @scenario "The value is the month's price in dollars to four places" */
    it("sends the month's spend as dollars to four places", async () => {
      // 12345678900 nano-USD is 12.3456789 USD, which the meter unit truncates
      // to 123456 ten-thousandths, so the value is 12.3456.
      mockQueryInstantEvalSpendTotal.mockResolvedValue(123_456);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [expect.objectContaining({ value: 12.3456 })],
        }),
      );
    });

    /** @scenario "A second report sends only the delta since the checkpoint" */
    it("sends the delta since the meter's own checkpoint, named in the identifier", async () => {
      mockBillingCheckpoints.getCheckpoint.mockImplementation(
        async ({ meter }: { meter: string }) =>
          meter === INSTANT_EVAL_METER
            ? {
                lastReportedTotal: 10_000,
                pendingReportedTotal: null,
                consecutiveFailures: 0,
              }
            : null,
      );
      mockQueryInstantEvalSpendTotal.mockResolvedValue(15_000);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [
            expect.objectContaining({
              eventName: INSTANT_EVAL_METER,
              value: 0.5,
              identifier: `org-1:2026-02:${INSTANT_EVAL_METER}:from:10000:to:15000`,
            }),
          ],
        }),
      );
      expect(mockBillingCheckpoints.confirm).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        meter: INSTANT_EVAL_METER,
        lastReportedTotal: 15_000,
      });
    });

    /** @scenario "The Instant Eval meter keeps its own checkpoint" */
    it("keeps each meter's checkpoint under its own name and the events identifier unchanged", async () => {
      mockQueryBillableEventsTotal.mockResolvedValue(50);
      mockQueryInstantEvalSpendTotal.mockResolvedValue(20_000);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockBillingCheckpoints.writeIntent).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        meter: EVENTS_METER,
        lastReportedTotal: 0,
        pendingReportedTotal: 50,
      });
      expect(mockBillingCheckpoints.writeIntent).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        meter: INSTANT_EVAL_METER,
        lastReportedTotal: 0,
        pendingReportedTotal: 20_000,
      });
      const identifiers = (
        mockReportUsageDelta.mock.calls as Array<
          [{ events: Array<{ identifier: string }> }]
        >
      ).map(([input]) => input.events[0]!.identifier);
      expect(identifiers).toEqual([
        "org-1:2026-02:from:0:to:50",
        `org-1:2026-02:${INSTANT_EVAL_METER}:from:0:to:20000`,
      ]);
    });

    /** @scenario "The Instant Eval meter is reported only once Stripe holds it" */
    it("leaves the month unreported and its checkpoint untouched while the meter is unmapped", async () => {
      isInstantEvalMeterProvisioned = false;
      try {
        mockQueryBillableEventsTotal.mockResolvedValue(50);
        mockQueryInstantEvalSpendTotal.mockResolvedValue(20_000);
        const handler = await createHandler();

        await handler.handle(makeCommand());

        expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
        expect(mockReportUsageDelta).toHaveBeenCalledWith(
          expect.objectContaining({
            events: [expect.objectContaining({ eventName: EVENTS_METER })],
          }),
        );
        // No intent and no read: the whole total waits for the mapping, so
        // the first report after it lands carries the month from zero.
        expect(mockQueryInstantEvalSpendTotal).not.toHaveBeenCalled();
        expect(mockBillingCheckpoints.writeIntent).not.toHaveBeenCalledWith(
          expect.objectContaining({ meter: INSTANT_EVAL_METER }),
        );
      } finally {
        isInstantEvalMeterProvisioned = true;
      }
    });

    /** @scenario "A month with no Instant Eval spend reports nothing on that meter" */
    it("sends nothing on the Instant Evals meter when the month spent nothing", async () => {
      mockQueryBillableEventsTotal.mockResolvedValue(50);
      mockQueryInstantEvalSpendTotal.mockResolvedValue(0);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [expect.objectContaining({ eventName: EVENTS_METER })],
        }),
      );
    });
  });

  // ========================================================================
  // A connected self-hosted customer
  // ========================================================================

  describe("given a connected self-hosted customer", () => {
    const INSTANT_EVAL_METER = "langwatch_instant_eval_usd";

    beforeEach(() => {
      mockBillingCheckpoints.getCheckpoint.mockResolvedValue(null);
      mockBillingCheckpoints.writeIntent.mockResolvedValue(undefined);
      mockBillingCheckpoints.confirm.mockResolvedValue(undefined);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      mockSelfDispatch.mockResolvedValue(undefined);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** @scenario "Hosted usage of a connected customer reaches its metered subscription" */
    it("reports its hosted spend against the customer its billing account names", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg({
          contract: "connected",
          stripeCustomerId: "cus_connected",
        }),
      );
      mockQueryBillableEventsTotal.mockResolvedValue(0);
      mockQueryInstantEvalSpendTotal.mockResolvedValue(25_000);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          stripeCustomerId: "cus_connected",
          events: [
            expect.objectContaining({
              eventName: INSTANT_EVAL_METER,
              value: 2.5,
            }),
          ],
        }),
      );
    });

    /** @scenario "A connected customer is not skipped for lacking a Cloud plan" */
    it("is not skipped for having no Cloud plan, and is not reported as one", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg({ contract: "connected" }),
      );
      mockQueryBillableEventsTotal.mockResolvedValue(0);
      mockQueryInstantEvalSpendTotal.mockResolvedValue(10_000);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
      expect(mockLogger.debug).not.toHaveBeenCalledWith(
        expect.anything(),
        "organization is not on usage-based pricing, skipping usage reporting",
      );
    });

    /** @scenario "Usage older than the meter accepts is not sent with a stale timestamp" */
    it("dates the event inside the month it belongs to while the meter accepts it", async () => {
      // The month ended three days ago, which is well inside the window the
      // meter accepts, and the quarterly invoice covering it is still open.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-04T00:00:00.000Z"));
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg({ contract: "connected" }),
      );
      mockQueryBillableEventsTotal.mockResolvedValue(0);
      mockQueryInstantEvalSpendTotal.mockResolvedValue(10_000);
      const handler = await createHandler();

      await handler.handle(makeCommand("org-1", "2026-02"));

      const event = mockReportUsageDelta.mock.calls[0]![0].events[0];
      expect(event.timestamp).toBe(
        Math.floor(Date.parse("2026-03-01T00:00:00.000Z") / 1000),
      );
    });

    /** @scenario "Usage older than the meter accepts is not sent with a stale timestamp" */
    it("reports a month older than the meter accepts at the current time, in full", async () => {
      // February 2026 ended more than 35 days before this tick.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-10T00:00:00.000Z"));
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg({ contract: "connected" }),
      );
      mockQueryBillableEventsTotal.mockResolvedValue(0);
      mockQueryInstantEvalSpendTotal.mockResolvedValue(10_000);
      const handler = await createHandler();

      await handler.handle(makeCommand("org-1", "2026-02"));

      const event = mockReportUsageDelta.mock.calls[0]![0].events[0];
      expect(event.timestamp).toBe(
        Math.floor(Date.parse("2026-06-10T00:00:00.000Z") / 1000),
      );
      // The amount is never trimmed to fit the window: the identifier still
      // names February, so the line stays attributable on the invoice.
      expect(event.value).toBe(1);
      expect(event.identifier).toContain("2026-02");
    });

    /** @scenario "Reporting the same usage twice does not double it" */
    it("sends nothing on a second pass when the month gained no spend", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg({ contract: "connected" }),
      );
      mockQueryBillableEventsTotal.mockResolvedValue(0);
      mockQueryInstantEvalSpendTotal.mockResolvedValue(10_000);
      mockBillingCheckpoints.getCheckpoint.mockImplementation(
        async ({ meter }: { meter: string }) =>
          meter === INSTANT_EVAL_METER
            ? { lastReportedTotal: 10_000, consecutiveFailures: 0 }
            : null,
      );
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockBillingCheckpoints.writeIntent).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Static properties
  // ========================================================================

  describe("static properties", () => {
    it("exposes schema, getAggregateId, and getSpanAttributes", async () => {
      const { ReportUsageForMonthCommand } = await import(
        "../reportUsageForMonth.command"
      );

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
