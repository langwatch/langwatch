/**
 * Unit tests for the reportUsageForMonth command handler.
 * @see specs/licensing/billing-meter-dispatch.feature
 * @see specs/self-hosting/connected-services/connected-billing.feature
 */

import type { ReportUsageForMonthCommandData } from "@langwatch/enterprise-billing-contract";
import type { Command } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BillingCheckpointRepository } from "../../repositories/billing-checkpoint.repository.ts";
import { MemoryBillingCheckpointRepository } from "../../repositories/memory/memory.billing-checkpoint.repository.ts";
import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import type { PriceLine } from "../../rules/price-line.rules.ts";
import type { BillableEventsTotalResult } from "../../rules/billing-month.rules.ts";
import { PiiRedactionSpendQueryService } from "../../services/pii-redaction-spend-query.service.ts";

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
  mockQueryPiiRedactionSpendTotal,
  mockConnectedUsageCeiling,
  mockSubscriptionPriceLine,
  mockLogger,
} = vi.hoisted(() => {
  const reportUsageDeltaFn = vi.fn();
  const selfDispatchFn = vi.fn();
  const captureExceptionFn = vi.fn();
  const queryInstantEvalSpendTotalFn = vi.fn();
  const queryPiiRedactionSpendTotalFn = vi.fn();

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
  const subscriptionPriceLineFn =
    vi.fn<
      (input: {
        stripeCustomerId: string;
        price: string;
        billingMonth: string;
      }) => Promise<PriceLine>
    >();

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
    mockQueryPiiRedactionSpendTotal: queryPiiRedactionSpendTotalFn,
    mockConnectedUsageCeiling: connectedUsageCeilingFn,
    mockSubscriptionPriceLine: subscriptionPriceLineFn,
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
/** Whether the catalogue maps an Instant Evals meter in the mode under test. */
let instantEvalMeterProvisioned = true;
/** Whether the catalogue maps the PII redaction meter in the mode under test. */
let piiRedactionMeterProvisioned = true;
/** The prices the customer's subscription has no line on; every other price it carries. */
let missingPrices: string[] = [];
/** A priced line that carries no read start, so the month keeps its other bounds. */
const CARRIED: PriceLine = { carried: true, addedAtMs: null };
const lineFor = (carried: boolean): PriceLine => (carried ? CARRIED : { carried: false });

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

type GrowthSeatPeriod = { startMs: number | null; endMs: number | null };

/** One live Cloud subscription from `usageBilledSinceMs`, unless `growthSeatPeriods` is given. */
function usageBilledOrg({
  id = "org-1",
  stripeCustomerId = "cus_123",
  hasSubscription = true,
  contract = "cloud" as const,
  usageBilledSinceMs = null,
  growthSeatPeriods,
}: {
  id?: string;
  stripeCustomerId?: string | null;
  hasSubscription?: boolean;
  contract?: "cloud" | "connected";
  usageBilledSinceMs?: number | null;
  growthSeatPeriods?: GrowthSeatPeriod[];
} = {}) {
  const live = contract === "cloud" && hasSubscription;

  return {
    outcome: "usage_billed" as const,
    organization: {
      id,
      stripeCustomerId,
      subscriptions: hasSubscription ? [{ id: "sub-1" }] : [],
      contract,
      growthSeatPeriods:
        growthSeatPeriods ?? (live ? [{ startMs: usageBilledSinceMs, endMs: null }] : []),
    },
  };
}

async function createHandler({
  billingCheckpoints = mockBillingCheckpoints as any,
}: { billingCheckpoints?: BillingCheckpointRepository } = {}) {
  const { ReportUsageForMonthCommandHandler } =
    await import("../report-usage-for-month.commands.ts");

  return new ReportUsageForMonthCommandHandler({
    organizations: mockOrganizations as any,
    billingCheckpoints,
    getUsageReportingService: () => ({
      reportUsageDelta: mockReportUsageDelta,
      reportUsageSet: vi.fn(),
      getUsageSummary: vi.fn(),
    }),
    queryInstantEvalSpendTotal: mockQueryInstantEvalSpendTotal,
    isInstantEvalMeterProvisioned: () => instantEvalMeterProvisioned,
    queryPiiRedactionSpendTotal: mockQueryPiiRedactionSpendTotal,
    isPiiRedactionMeterProvisioned: () => piiRedactionMeterProvisioned,
    subscriptionPriceLine: mockSubscriptionPriceLine,
    selfDispatch: mockSelfDispatch,
    organizationCache: missingOrganizationCache,
    errorReporter: errorReporter as any,
    connectedUsageCeiling: mockConnectedUsageCeiling,
  });
}

const UPGRADED_ON_10_FEBRUARY_MS = Date.UTC(2026, 1, 10, 13);

/** Reports February over a real checkpoint store; by default the upgrade was on the 10th. */
async function reportFebruary({
  reportedTotal,
  windowTotal,
  usageBilledSinceMs = UPGRADED_ON_10_FEBRUARY_MS,
  growthSeatPeriods,
}: {
  reportedTotal: number | null;
  windowTotal: number;
  usageBilledSinceMs?: number;
  growthSeatPeriods?: GrowthSeatPeriod[];
}) {
  const store = MemoryBillingStore.create();
  const checkpoints = MemoryBillingCheckpointRepository.create(store);
  const at = { organizationId: "org-1", billingMonth: "2026-02" };
  const meter = "langwatch_instant_eval_usd";
  if (reportedTotal !== null) {
    await checkpoints.confirm({ ...at, meter, lastReportedTotal: reportedTotal });
  }
  mockOrganizations.getOrganizationForBilling.mockResolvedValue(
    usageBilledOrg({ usageBilledSinceMs, growthSeatPeriods }),
  );
  mockQueryInstantEvalSpendTotal.mockResolvedValue({ outcome: "counted", total: windowTotal });
  mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
  const handler = await createHandler({ billingCheckpoints: checkpoints });

  await handler.handle(makeCommand());

  return {
    events: mockReportUsageDelta.mock.calls.flatMap(([input]) => input.events),
    checkpoint: await checkpoints.findCheckpoint({ ...at, meter }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function resetMocks() {
  vi.clearAllMocks();
  countedTotal = undefined;
  countedEventId = undefined;
  instantEvalMeterProvisioned = true;
  piiRedactionMeterProvisioned = true;
  // No spend ledger unless a test says otherwise, so the Instant Evals
  // meter stays out of the way of every assertion about the events one.
  mockQueryInstantEvalSpendTotal.mockResolvedValue({ outcome: "unavailable" });
  mockQueryPiiRedactionSpendTotal.mockResolvedValue({ outcome: "unavailable" });
  missingPrices = [];
  mockSubscriptionPriceLine.mockImplementation(async ({ price }) =>
    lineFor(!missingPrices.includes(price)),
  );
}

describe("ReportUsageForMonthCommand", () => {
  beforeEach(resetMocks);

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
    /** @scenario "Billing reports the month's total to Stripe from usage's month_counted event" */
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

  describe("given a Stripe mode whose catalogue maps no Instant Evals meter", () => {
    /** @scenario "The Instant Eval meter is reported only once Stripe holds it" */
    it("reports the events meter and leaves the Instant Evals meter and its checkpoint alone", async () => {
      instantEvalMeterProvisioned = false;
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      countedTotal = 150;
      mockQueryInstantEvalSpendTotal.mockResolvedValue({ outcome: "counted", total: 12_345 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [expect.objectContaining({ eventName: "langwatch_billable_events", value: 150 })],
        }),
      );
      expect(mockQueryInstantEvalSpendTotal).not.toHaveBeenCalled();
      expect(mockBillingCheckpoints.findCheckpoint).not.toHaveBeenCalledWith(
        expect.objectContaining({ meter: "langwatch_instant_eval_usd" }),
      );
      expect(mockBillingCheckpoints.writeIntent).not.toHaveBeenCalledWith(
        expect.objectContaining({ meter: "langwatch_instant_eval_usd" }),
      );
      expect(mockBillingCheckpoints.confirm).not.toHaveBeenCalledWith(
        expect.objectContaining({ meter: "langwatch_instant_eval_usd" }),
      );
    });
  });

  describe("given a Growth subscription in dollars with no Instant Evals price", () => {
    beforeEach(() => {
      missingPrices = ["GROWTH_INSTANT_EVAL_USD"];
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      // 0.30 dollars of Instant Eval spend, which Stripe would bill at nothing.
      mockQueryInstantEvalSpendTotal.mockResolvedValue({ outcome: "counted", total: 3_000 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
    });

    /** @scenario "Usage is held while the subscription carries no Instant Evals price" */
    it("sends no Instant Eval event, leaves its checkpoint alone and schedules nothing", async () => {
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockSubscriptionPriceLine).toHaveBeenCalledWith({
        stripeCustomerId: "cus_123",
        price: "GROWTH_INSTANT_EVAL_USD",
        billingMonth: "2026-02",
      });
      expect(mockBillingCheckpoints.writeIntent).not.toHaveBeenCalled();
      expect(mockBillingCheckpoints.confirm).not.toHaveBeenCalled();
      expect(mockBillingCheckpoints.incrementFailures).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });

    /** @scenario "Usage is held while the subscription carries no Instant Evals price" */
    it("warns with the organization, the meter and the amount held", async () => {
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          meter: "langwatch_instant_eval_usd",
          heldValue: 0.3,
        }),
        expect.stringContaining("holding"),
      );
    });

    /** @scenario "A pending total is replayed even while the price is missing" */
    it("replays a pending total under its own identifier", async () => {
      mockBillingCheckpoints.findCheckpoint.mockImplementation(
        async ({ meter }: { meter: string }) =>
          meter === "langwatch_instant_eval_usd"
            ? { lastReportedTotal: 0, pendingReportedTotal: 3_000, consecutiveFailures: 0 }
            : null,
      );
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
      expect(mockReportUsageDelta.mock.calls[0]?.[0].events[0]).toMatchObject({
        eventName: "langwatch_instant_eval_usd",
        identifier: "org-1:2026-02:langwatch_instant_eval_usd:from:0:to:3000",
      });
    });

    /** @scenario "Usage is held while the subscription carries no Instant Evals price" */
    it("still reports the billable events meter", async () => {
      countedTotal = 150;
      const handler = await createHandler();

      await handler.handle(makeCommand());

      const sent = mockReportUsageDelta.mock.calls.map(([input]) => input.events[0].eventName);
      expect(sent).toEqual(["langwatch_billable_events"]);
    });

    /** @scenario "The first report after the Instant Evals price is added bills only from the line" */
    it("reads the month from the line, not its first day, on the first report after it is added", async () => {
      const lineAddedAtMs = Date.UTC(2026, 1, 12, 15);
      const handler = await createHandler();

      await handler.handle(makeCommand());
      mockSubscriptionPriceLine.mockResolvedValue({ carried: true, addedAtMs: lineAddedAtMs });
      await handler.handle(makeCommand());

      expect(mockQueryInstantEvalSpendTotal).toHaveBeenLastCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        usageBilledSinceMs: lineAddedAtMs,
      });
      expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
      expect(mockReportUsageDelta.mock.calls[0]?.[0].events[0]).toMatchObject({
        eventName: "langwatch_instant_eval_usd",
        identifier: "org-1:2026-02:langwatch_instant_eval_usd:from:0:to:3000",
        value: 0.3,
      });
    });
  });

  describe("given a Growth subscription in euros", () => {
    /** @scenario "A Growth subscription in euros holds its Instant Eval usage" */
    it("sends no Instant Eval event and leaves its checkpoint alone", async () => {
      // A euro subscription's lines; the Instant Evals price is in dollars, so it is never one.
      const euroLines = ["GROWTH_SEAT_EUR_MONTHLY", "GROWTH_EVENTS_EUR_MONTHLY"];
      mockSubscriptionPriceLine.mockImplementation(async ({ price }) =>
        lineFor(euroLines.includes(price)),
      );
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      countedTotal = 150;
      mockQueryInstantEvalSpendTotal.mockResolvedValue({ outcome: "counted", total: 3_000 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockSubscriptionPriceLine).toHaveBeenCalledWith({
        stripeCustomerId: "cus_123",
        price: "GROWTH_INSTANT_EVAL_USD",
        billingMonth: "2026-02",
      });
      const sent = mockReportUsageDelta.mock.calls.map(([input]) => input.events[0].eventName);
      expect(sent).toEqual(["langwatch_billable_events"]);
      expect(mockBillingCheckpoints.writeIntent).not.toHaveBeenCalledWith(
        expect.objectContaining({ meter: "langwatch_instant_eval_usd" }),
      );
    });
  });

  describe("given a Growth subscription in dollars with the Instant Evals price", () => {
    /** @scenario "Usage is reported once the subscription carries the Instant Evals price" */
    it("sends the month's 5.0428 dollars and checkpoints it", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      mockQueryInstantEvalSpendTotal.mockResolvedValue({ outcome: "counted", total: 50_428 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockSubscriptionPriceLine).toHaveBeenCalledWith({
        stripeCustomerId: "cus_123",
        price: "GROWTH_INSTANT_EVAL_USD",
        billingMonth: "2026-02",
      });
      expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
      expect(mockReportUsageDelta.mock.calls[0]?.[0]).toMatchObject({
        stripeCustomerId: "cus_123",
        events: [
          expect.objectContaining({
            eventName: "langwatch_instant_eval_usd",
            identifier: "org-1:2026-02:langwatch_instant_eval_usd:from:0:to:50428",
            value: 5.0428,
          }),
        ],
      });
      expect(mockBillingCheckpoints.confirm).toHaveBeenCalledWith({
        meter: "langwatch_instant_eval_usd",
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 50_428,
      });
    });
  });

  describe("given a subscription whose Instant Evals price cannot be read", () => {
    /** @scenario "A subscription that cannot be read holds the Instant Eval usage and retries" */
    it("sends no Instant Eval event, leaves its checkpoint alone and schedules another report", async () => {
      mockSubscriptionPriceLine.mockImplementation(async ({ price }) => {
        if (price === "GROWTH_INSTANT_EVAL_USD") throw new Error("stripe unavailable");
        return CARRIED;
      });
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      mockQueryInstantEvalSpendTotal.mockResolvedValue({ outcome: "counted", total: 3_000 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockBillingCheckpoints.writeIntent).not.toHaveBeenCalled();
      expect(mockBillingCheckpoints.incrementFailures).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        meter: "langwatch_instant_eval_usd",
        lastReportedTotal: 0,
        pendingReportedTotal: null,
        consecutiveFailures: 1,
      });
      expect(mockSelfDispatch).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a price read that always fails", () => {
    /** @scenario "A price read that keeps failing stops at the circuit breaker" */
    it("stops reading and scheduling after five failed reads", async () => {
      const store = MemoryBillingStore.create();
      const checkpoints = MemoryBillingCheckpointRepository.create(store);
      mockSubscriptionPriceLine.mockImplementation(async ({ price }) => {
        if (price === "GROWTH_INSTANT_EVAL_USD") throw new Error("No such customer");
        return CARRIED;
      });
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockQueryInstantEvalSpendTotal.mockResolvedValue({ outcome: "counted", total: 3_000 });
      const handler = await createHandler({ billingCheckpoints: checkpoints });

      for (let run = 0; run < 8; run++) await handler.handle(makeCommand());

      const reads = mockSubscriptionPriceLine.mock.calls.filter(
        ([input]) => input.price === "GROWTH_INSTANT_EVAL_USD",
      );
      expect(reads).toHaveLength(5);
      expect(mockSelfDispatch).toHaveBeenCalledTimes(5);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(
        await checkpoints.findCheckpoint({
          organizationId: "org-1",
          billingMonth: "2026-02",
          meter: "langwatch_instant_eval_usd",
        }),
      ).toMatchObject({ lastReportedTotal: 0, pendingReportedTotal: null, consecutiveFailures: 5 });
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ meter: "langwatch_instant_eval_usd", consecutiveFailures: 5 }),
        expect.stringContaining("ALARM"),
      );
    });
  });

  describe("given four failed price reads and then a read that succeeds", () => {
    /** @scenario "A price read that works again clears the failed reads" */
    it.each([
      { case: "priced with nothing new to send", priced: true },
      { case: "held without a line", priced: false },
    ])("clears the failures when the read is $case", async ({ priced }) => {
      const store = MemoryBillingStore.create();
      const checkpoints = MemoryBillingCheckpointRepository.create(store);
      let instantReads = 0;
      mockSubscriptionPriceLine.mockImplementation(async ({ price }) => {
        if (price !== "GROWTH_INSTANT_EVAL_USD") return CARRIED;
        instantReads += 1;
        if (instantReads <= 4) throw new Error("Stripe unavailable");
        return lineFor(priced);
      });
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockQueryInstantEvalSpendTotal.mockResolvedValue({ outcome: "counted", total: 0 });
      const handler = await createHandler({ billingCheckpoints: checkpoints });

      for (let run = 0; run < 5; run++) await handler.handle(makeCommand());

      expect(instantReads).toBe(5);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(
        await checkpoints.findCheckpoint({
          organizationId: "org-1",
          billingMonth: "2026-02",
          meter: "langwatch_instant_eval_usd",
        }),
      ).toMatchObject({ lastReportedTotal: 0, pendingReportedTotal: null, consecutiveFailures: 0 });
    });
  });

  describe("given the Instant Eval checkpoint reported 1.0000 dollars and the month is now 1.5000", () => {
    /** @scenario "A second report sends only the delta since the checkpoint" */
    it("sends 0.5000 under an identifier naming the meter, the month and both totals", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockImplementation(
        async ({ meter }: { meter: string }) =>
          meter === "langwatch_instant_eval_usd"
            ? { lastReportedTotal: 10_000, pendingReportedTotal: null, consecutiveFailures: 0 }
            : null,
      );
      mockQueryInstantEvalSpendTotal.mockResolvedValue({ outcome: "counted", total: 15_000 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
      expect(mockReportUsageDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          events: [
            expect.objectContaining({
              eventName: "langwatch_instant_eval_usd",
              identifier: "org-1:2026-02:langwatch_instant_eval_usd:from:10000:to:15000",
              value: 0.5,
            }),
          ],
        }),
      );
      expect(mockBillingCheckpoints.confirm).toHaveBeenCalledWith({
        meter: "langwatch_instant_eval_usd",
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 15_000,
      });
    });
  });

  describe("given a usage-billed subscription that started on 10 February", () => {
    /** @scenario "Free use before an upgrade mid-month is not reported" */
    it("reads the month from the subscription's start and sends only the spend since", async () => {
      const { events, checkpoint } = await reportFebruary({
        reportedTotal: null,
        windowTotal: 5_000,
      });

      expect(mockQueryInstantEvalSpendTotal).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        usageBilledSinceMs: UPGRADED_ON_10_FEBRUARY_MS,
      });
      expect(events).toEqual([
        expect.objectContaining({
          eventName: "langwatch_instant_eval_usd",
          identifier: "org-1:2026-02:langwatch_instant_eval_usd:from:0:to:5000",
          value: 0.5,
        }),
      ]);
      expect(checkpoint).toMatchObject({ lastReportedTotal: 5_000, pendingReportedTotal: null });
    });

    /** @scenario "A month already reported is not lowered by the subscription window" */
    it("sends nothing and keeps the checkpoint when the window reads less than was reported", async () => {
      const { events, checkpoint } = await reportFebruary({
        reportedTotal: 15_000,
        windowTotal: 5_000,
      });

      expect(events).toEqual([]);
      expect(checkpoint).toMatchObject({ lastReportedTotal: 15_000, pendingReportedTotal: null });
      expect(mockSelfDispatch).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          organizationId: "org-1",
          billingMonth: "2026-02",
          meter: "langwatch_instant_eval_usd",
          measured: 5_000,
          reported: 15_000,
        },
        "the subscription window read less than was reported; keeping the reported total",
      );
    });

    /** @scenario "A month already reported is not lowered by the subscription window" */
    it("reports spend past the reported total as a positive delta", async () => {
      const { events, checkpoint } = await reportFebruary({
        reportedTotal: 15_000,
        windowTotal: 20_000,
      });

      expect(events).toEqual([
        expect.objectContaining({
          identifier: "org-1:2026-02:langwatch_instant_eval_usd:from:15000:to:20000",
          value: 0.5,
        }),
      ]);
      expect(checkpoint).toMatchObject({ lastReportedTotal: 20_000, pendingReportedTotal: null });
    });
  });

  describe("given a subscription replaced by a new one on 15 February after February was reported", () => {
    const REPLACED_STARTED_MS = Date.UTC(2025, 5, 15);
    const REPLACED_ON_15_FEBRUARY_MS = Date.UTC(2026, 1, 15, 9);

    /** @scenario "A subscription replaced mid-month keeps the month's window" */
    it("reads from the replaced subscription's start and sends the spend since as a positive delta", async () => {
      const { events, checkpoint } = await reportFebruary({
        reportedTotal: 15_000,
        windowTotal: 20_000,
        growthSeatPeriods: [
          { startMs: REPLACED_ON_15_FEBRUARY_MS, endMs: null },
          { startMs: REPLACED_STARTED_MS, endMs: REPLACED_ON_15_FEBRUARY_MS },
        ],
      });

      expect(mockQueryInstantEvalSpendTotal).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        usageBilledSinceMs: REPLACED_STARTED_MS,
      });
      expect(events).toEqual([
        expect.objectContaining({
          eventName: "langwatch_instant_eval_usd",
          identifier: "org-1:2026-02:langwatch_instant_eval_usd:from:15000:to:20000",
          value: 0.5,
        }),
      ]);
      expect(checkpoint).toMatchObject({ lastReportedTotal: 20_000, pendingReportedTotal: null });
    });
  });

  describe("given a usage-billed subscription older than the month", () => {
    /** @scenario "A subscription older than the month reports the whole month" */
    it("passes its start through and still sends a lower corrected total", async () => {
      const startedAtMs = Date.UTC(2025, 5, 15);
      const { events, checkpoint } = await reportFebruary({
        reportedTotal: 15_000,
        windowTotal: 12_000,
        usageBilledSinceMs: startedAtMs,
      });

      expect(mockQueryInstantEvalSpendTotal).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        usageBilledSinceMs: startedAtMs,
      });
      expect(events).toEqual([
        expect.objectContaining({
          identifier: "org-1:2026-02:langwatch_instant_eval_usd:from:15000:to:12000",
          value: -0.3,
        }),
      ]);
      expect(checkpoint).toMatchObject({ lastReportedTotal: 12_000 });
    });
  });

  describe("given a usage-billed organization with no recorded subscription start", () => {
    /** @scenario "A subscription with no recorded start reports the whole month" */
    it.each([
      { case: "a subscription with no start date", lookup: usageBilledOrg() },
      { case: "a connected account", lookup: usageBilledOrg({ contract: "connected" }) },
    ])("asks for the whole month for $case", async ({ lookup }) => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(lookup);
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockQueryInstantEvalSpendTotal).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        usageBilledSinceMs: null,
      });
    });
  });

  describe("given billable events, Instant Eval spend and PII redaction spend in one month", () => {
    /** @scenario "The PII redaction meter keeps its own checkpoint" */
    /** @scenario "The meter is named langwatch_pii_redaction_usd" */
    /** @scenario "The value is the month's price in dollars to four places" */
    it("reports PII redaction on its own meter, checkpoint and identifier, leaving the others unchanged", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      countedTotal = 150;
      mockQueryInstantEvalSpendTotal.mockResolvedValue({ outcome: "counted", total: 12_345 });
      mockQueryPiiRedactionSpendTotal.mockResolvedValue({ outcome: "counted", total: 123_456 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledTimes(3);
      const sent = mockReportUsageDelta.mock.calls.map(([input]) => input.events[0]);
      expect(sent).toEqual([
        expect.objectContaining({
          eventName: "langwatch_billable_events",
          identifier: "org-1:2026-02:from:0:to:150",
        }),
        expect.objectContaining({
          eventName: "langwatch_instant_eval_usd",
          identifier: "org-1:2026-02:langwatch_instant_eval_usd:from:0:to:12345",
        }),
        expect.objectContaining({
          eventName: "langwatch_pii_redaction_usd",
          identifier: "org-1:2026-02:langwatch_pii_redaction_usd:from:0:to:123456",
          value: 12.3456,
        }),
      ]);
      expect(mockBillingCheckpoints.confirm).toHaveBeenCalledWith({
        meter: "langwatch_pii_redaction_usd",
        organizationId: "org-1",
        billingMonth: "2026-02",
        lastReportedTotal: 123_456,
      });
    });
  });

  describe("given a Stripe mode whose catalogue maps no PII redaction meter", () => {
    /** @scenario "The PII redaction meter is reported only once Stripe holds it" */
    it("sends no PII redaction event and leaves its checkpoint alone", async () => {
      piiRedactionMeterProvisioned = false;
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      mockQueryPiiRedactionSpendTotal.mockResolvedValue({ outcome: "counted", total: 5_000 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockQueryPiiRedactionSpendTotal).not.toHaveBeenCalled();
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockBillingCheckpoints.writeIntent).not.toHaveBeenCalledWith(
        expect.objectContaining({ meter: "langwatch_pii_redaction_usd" }),
      );
    });

    it("carries the month from zero on the first report after the meter is mapped", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      mockQueryPiiRedactionSpendTotal.mockResolvedValue({ outcome: "counted", total: 5_000 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      piiRedactionMeterProvisioned = false;
      await handler.handle(makeCommand());
      piiRedactionMeterProvisioned = true;
      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
      expect(mockReportUsageDelta.mock.calls[0]?.[0].events[0]).toMatchObject({
        eventName: "langwatch_pii_redaction_usd",
        identifier: "org-1:2026-02:langwatch_pii_redaction_usd:from:0:to:5000",
        value: 0.5,
      });
    });
  });

  describe("given an active subscription with no PII redaction price", () => {
    /** @scenario "Usage is held while the subscription carries no PII redaction price" */
    it("sends no PII redaction event, leaves its checkpoint alone and schedules nothing", async () => {
      missingPrices = ["GROWTH_PII_REDACTION_USD"];
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      mockQueryPiiRedactionSpendTotal.mockResolvedValue({ outcome: "counted", total: 5_000 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockSubscriptionPriceLine).toHaveBeenCalledWith({
        stripeCustomerId: "cus_123",
        price: "GROWTH_PII_REDACTION_USD",
        billingMonth: "2026-02",
      });
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockBillingCheckpoints.writeIntent).not.toHaveBeenCalled();
      expect(mockBillingCheckpoints.confirm).not.toHaveBeenCalled();
      expect(mockSelfDispatch).not.toHaveBeenCalled();
    });

    /** @scenario "Usage is held while the subscription carries no PII redaction price" */
    it("reads the month from the line, not its first day, on the first report after it is added", async () => {
      const lineAddedAtMs = Date.UTC(2026, 1, 12, 15);
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      mockQueryPiiRedactionSpendTotal.mockResolvedValue({ outcome: "counted", total: 5_000 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      missingPrices = ["GROWTH_PII_REDACTION_USD"];
      await handler.handle(makeCommand());
      mockSubscriptionPriceLine.mockResolvedValue({ carried: true, addedAtMs: lineAddedAtMs });
      await handler.handle(makeCommand());

      expect(mockQueryPiiRedactionSpendTotal).toHaveBeenLastCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        usageBilledSinceMs: lineAddedAtMs,
      });
      expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
      expect(mockReportUsageDelta.mock.calls[0]?.[0].events[0]).toMatchObject({
        eventName: "langwatch_pii_redaction_usd",
        identifier: "org-1:2026-02:langwatch_pii_redaction_usd:from:0:to:5000",
        value: 0.5,
      });
    });

    /** @scenario "The other meters do not wait on the PII redaction price" */
    it("still reports the billable events and Instant Evals meters", async () => {
      missingPrices = ["GROWTH_PII_REDACTION_USD"];
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      countedTotal = 150;
      mockQueryInstantEvalSpendTotal.mockResolvedValue({ outcome: "counted", total: 12_345 });
      mockQueryPiiRedactionSpendTotal.mockResolvedValue({ outcome: "counted", total: 5_000 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      const sent = mockReportUsageDelta.mock.calls.map(([input]) => input.events[0].eventName);
      expect(sent).toEqual(["langwatch_billable_events", "langwatch_instant_eval_usd"]);
    });
  });

  describe("given an active subscription with the PII redaction price", () => {
    /** @scenario "Usage is reported once the subscription carries the PII redaction price" */
    it("sends the PII redaction meter event", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      mockQueryPiiRedactionSpendTotal.mockResolvedValue({ outcome: "counted", total: 5_000 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
      expect(mockReportUsageDelta.mock.calls[0]?.[0]).toMatchObject({
        stripeCustomerId: "cus_123",
        events: [expect.objectContaining({ eventName: "langwatch_pii_redaction_usd" })],
      });
    });
  });

  describe("given a subscription Stripe cannot read", () => {
    /** @scenario "A subscription that cannot be read holds the usage and retries" */
    it("sends no PII redaction event, leaves its checkpoint alone and schedules another report", async () => {
      mockSubscriptionPriceLine.mockImplementation(async ({ price }) => {
        if (price === "GROWTH_PII_REDACTION_USD") throw new Error("stripe unavailable");
        return CARRIED;
      });
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      mockQueryPiiRedactionSpendTotal.mockResolvedValue({ outcome: "counted", total: 5_000 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(mockBillingCheckpoints.writeIntent).not.toHaveBeenCalled();
      expect(mockBillingCheckpoints.incrementFailures).toHaveBeenCalledWith(
        expect.objectContaining({
          meter: "langwatch_pii_redaction_usd",
          pendingReportedTotal: null,
          consecutiveFailures: 1,
        }),
      );
      expect(mockSelfDispatch).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the PII redaction checkpoint reported 1.0000 dollars and the month is now 1.5000", () => {
    /** @scenario "A second report sends only the delta since the checkpoint" */
    it("sends 0.5000 under an identifier naming the meter, the month and both totals", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockImplementation(
        async ({ meter }: { meter: string }) =>
          meter === "langwatch_pii_redaction_usd"
            ? { lastReportedTotal: 10_000, pendingReportedTotal: null, consecutiveFailures: 0 }
            : null,
      );
      mockQueryPiiRedactionSpendTotal.mockResolvedValue({ outcome: "counted", total: 15_000 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
      expect(mockReportUsageDelta.mock.calls[0]?.[0].events[0]).toMatchObject({
        eventName: "langwatch_pii_redaction_usd",
        identifier: "org-1:2026-02:langwatch_pii_redaction_usd:from:10000:to:15000",
        value: 0.5,
      });
    });
  });

  describe("given an organization with no active subscription and PII redaction spend", () => {
    /** @scenario "An organization that is not usage billed reports nothing" */
    it("reads no spend and sends nothing", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(
        usageBilledOrg({ hasSubscription: false }),
      );
      mockQueryPiiRedactionSpendTotal.mockResolvedValue({ outcome: "counted", total: 5_000 });
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
    });
  });

  describe("given a month with no PII redaction spend", () => {
    it("sends no PII redaction event", async () => {
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      mockQueryPiiRedactionSpendTotal.mockResolvedValue({ outcome: "counted", total: 0 });
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).not.toHaveBeenCalled();
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
    /** @scenario A usage report that cannot read the organization is retried, not dropped */
    it("reports the error and raises it so the command is retried", async () => {
      mockOrganizations.getOrganizationForBilling.mockRejectedValue(new Error("database offline"));
      const handler = await createHandler();

      await expect(handler.handle(makeCommand())).rejects.toThrow("database offline");

      expect(mockCaptureException).toHaveBeenCalled();
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
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

    /** @scenario "Hosted usage is reported without a price check until its meter is confirmed" */
    it("reports hosted usage without asking the subscription for any Instant Evals price", async () => {
      arrange({ measured: 90_000, ceiling: null });
      missingPrices = ["GROWTH_INSTANT_EVAL_USD", "CONNECTED_HOSTED_USAGE_QUARTERLY"];
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockSubscriptionPriceLine).not.toHaveBeenCalledWith(
        expect.objectContaining({ price: "GROWTH_INSTANT_EVAL_USD" }),
      );
      expect(mockSubscriptionPriceLine).not.toHaveBeenCalledWith(
        expect.objectContaining({ price: "CONNECTED_HOSTED_USAGE_QUARTERLY" }),
      );
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

describe("ReportUsageForMonthCommand: the PII redaction price", () => {
  beforeEach(resetMocks);

  describe("given an active subscription with no PII redaction price", () => {
    /** @scenario "Usage is held while the subscription carries no PII redaction price" */
    it("warns with the organization, the PII redaction meter and the amount held", async () => {
      missingPrices = ["GROWTH_PII_REDACTION_USD"];
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockResolvedValue(null);
      mockQueryPiiRedactionSpendTotal.mockResolvedValue({ outcome: "counted", total: 5_000 });
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          meter: "langwatch_pii_redaction_usd",
          heldValue: 0.5,
        }),
        expect.stringContaining("holding"),
      );
    });

    /** @scenario "A pending PII redaction total is replayed even while the price is missing" */
    it("replays a pending PII redaction total under its own identifier", async () => {
      missingPrices = ["GROWTH_PII_REDACTION_USD"];
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockBillingCheckpoints.findCheckpoint.mockImplementation(
        async ({ meter }: { meter: string }) =>
          meter === "langwatch_pii_redaction_usd"
            ? { lastReportedTotal: 0, pendingReportedTotal: 5_000, consecutiveFailures: 0 }
            : null,
      );
      mockQueryPiiRedactionSpendTotal.mockResolvedValue({ outcome: "counted", total: 5_000 });
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler();

      await handler.handle(makeCommand());

      expect(mockReportUsageDelta).toHaveBeenCalledTimes(1);
      expect(mockReportUsageDelta.mock.calls[0]?.[0].events[0]).toMatchObject({
        eventName: "langwatch_pii_redaction_usd",
        identifier: "org-1:2026-02:langwatch_pii_redaction_usd:from:0:to:5000",
      });
    });
  });

  describe("given an organization that accepted the price on the 10th, read through the real spend query", () => {
    /** @scenario "An organization that accepted the price is billed only from the moment it accepted" */
    it("reports only the spend recorded from the moment of acceptance", async () => {
      const acceptedAtMs = Date.UTC(2026, 1, 10, 9);
      // 0.30 USD before the acceptance and 0.20 USD after it, in nano-USD.
      const ledger = [
        { atMs: Date.UTC(2026, 1, 5), nanoUsd: 300_000_000 },
        { atMs: Date.UTC(2026, 1, 20), nanoUsd: 200_000_000 },
      ];
      const spendQuery = PiiRedactionSpendQueryService.create({
        isSpendSourceAvailable: () => true,
        listProjectIds: async () => ["project-1"],
        findPiiRedactionModelAcceptedAtMs: async () => acceptedAtMs,
        sumSpendNanoUsdByRequestType: async ({ fromMs = 0, toMs = Infinity }) =>
          ledger
            .filter((row) => row.atMs >= fromMs && row.atMs < toMs)
            .reduce((sum, row) => sum + row.nanoUsd, 0),
      });
      const checkpoints = MemoryBillingCheckpointRepository.create(MemoryBillingStore.create());
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockQueryPiiRedactionSpendTotal.mockImplementation((input) =>
        spendQuery.queryPiiRedactionSpendTotal(input),
      );
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler({ billingCheckpoints: checkpoints });

      await handler.handle(makeCommand());

      const sent = mockReportUsageDelta.mock.calls
        .flatMap(([input]) => input.events)
        .filter((event) => event.eventName === "langwatch_pii_redaction_usd");
      expect(sent).toEqual([
        expect.objectContaining({
          identifier: "org-1:2026-02:langwatch_pii_redaction_usd:from:0:to:2000",
          value: 0.2,
        }),
      ]);
    });
  });

  describe("given a PII redaction total an earlier run left pending", () => {
    const at = { organizationId: "org-1", billingMonth: "2026-02" };
    const meter = "langwatch_pii_redaction_usd";

    /**
     * Leaves 5,000 units pending, as a send Stripe took whose confirm then failed, over a real
     * checkpoint store, then reports February `runs` times.
     */
    async function replayPending({
      eligible,
      runs = 1,
    }: {
      eligible: BillableEventsTotalResult | Error;
      runs?: number;
    }) {
      const checkpoints = MemoryBillingCheckpointRepository.create(MemoryBillingStore.create());
      await checkpoints.writeIntent({
        ...at,
        meter,
        lastReportedTotal: 0,
        pendingReportedTotal: 5_000,
      });
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      if (eligible instanceof Error) mockQueryPiiRedactionSpendTotal.mockRejectedValue(eligible);
      else mockQueryPiiRedactionSpendTotal.mockResolvedValue(eligible);
      mockReportUsageDelta.mockResolvedValue([{ reported: true }]);
      const handler = await createHandler({ billingCheckpoints: checkpoints });

      for (let run = 0; run < runs; run++) await handler.handle(makeCommand());

      return {
        sent: mockReportUsageDelta.mock.calls
          .flatMap(([input]) => input.events)
          .filter((event) => event.eventName === meter)
          .map(({ identifier, value }) => ({ identifier, value })),
        checkpoint: await checkpoints.findCheckpoint({ ...at, meter }),
      };
    }

    const replayed = { identifier: `org-1:2026-02:${meter}:from:0:to:5000`, value: 0.5 };

    /** @scenario "A pending PII redaction total is replayed even while the price is missing" */
    it("replays it under its own identifier while the acceptance's spend covers it", async () => {
      const { sent, checkpoint } = await replayPending({
        eligible: { outcome: "counted", total: 7_000 },
      });

      expect(sent).toEqual([replayed]);
      expect(checkpoint).toMatchObject({ lastReportedTotal: 5_000, pendingReportedTotal: null });
    });

    /** @scenario "A pending PII redaction total above the spend the acceptance covers is replayed, then corrected down" */
    it("replays it under its own identifier, then corrects the month down to the accepted spend", async () => {
      const { sent, checkpoint } = await replayPending({
        eligible: { outcome: "counted", total: 2_000 },
        runs: 2,
      });

      expect(sent).toEqual([
        replayed,
        { identifier: `org-1:2026-02:${meter}:from:5000:to:2000`, value: -0.3 },
      ]);
      expect(checkpoint).toMatchObject({ lastReportedTotal: 2_000, pendingReportedTotal: null });
    });

    /** @scenario "A pending PII redaction total above the spend the acceptance covers is replayed, then corrected down" */
    it("replays it, then corrects the month to zero for an organization that never accepted", async () => {
      const { sent, checkpoint } = await replayPending({
        eligible: { outcome: "counted", total: 0 },
        runs: 2,
      });

      expect(sent).toEqual([
        replayed,
        { identifier: `org-1:2026-02:${meter}:from:5000:to:0`, value: -0.5 },
      ]);
      expect(checkpoint).toMatchObject({ lastReportedTotal: 0, pendingReportedTotal: null });
    });

    /** @scenario "A pending PII redaction total is replayed without waiting for the spend to be read" */
    it.each([
      ["cannot be read", { outcome: "unavailable" } as const],
      ["read throws", new Error("ledger unreachable")],
    ])("replays it at once when the spend %s", async (_case, eligible) => {
      const { sent, checkpoint } = await replayPending({ eligible });

      expect(sent).toEqual([replayed]);
      expect(checkpoint).toMatchObject({ lastReportedTotal: 5_000, pendingReportedTotal: null });
    });
  });

  describe("given a PII redaction price read that always fails", () => {
    /** @scenario "A PII redaction price read that keeps failing stops at the circuit breaker" */
    it("stops reading and scheduling after five failed reads", async () => {
      const store = MemoryBillingStore.create();
      const checkpoints = MemoryBillingCheckpointRepository.create(store);
      mockSubscriptionPriceLine.mockImplementation(async ({ price }) => {
        if (price === "GROWTH_PII_REDACTION_USD") throw new Error("No such customer");
        return CARRIED;
      });
      mockOrganizations.getOrganizationForBilling.mockResolvedValue(usageBilledOrg());
      mockQueryPiiRedactionSpendTotal.mockResolvedValue({ outcome: "counted", total: 5_000 });
      const handler = await createHandler({ billingCheckpoints: checkpoints });

      for (let run = 0; run < 8; run++) await handler.handle(makeCommand());

      const reads = mockSubscriptionPriceLine.mock.calls.filter(
        ([input]) => input.price === "GROWTH_PII_REDACTION_USD",
      );
      expect(reads).toHaveLength(5);
      expect(mockSelfDispatch).toHaveBeenCalledTimes(5);
      expect(mockReportUsageDelta).not.toHaveBeenCalled();
      expect(
        await checkpoints.findCheckpoint({
          organizationId: "org-1",
          billingMonth: "2026-02",
          meter: "langwatch_pii_redaction_usd",
        }),
      ).toMatchObject({ lastReportedTotal: 0, pendingReportedTotal: null, consecutiveFailures: 5 });
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ meter: "langwatch_pii_redaction_usd", consecutiveFailures: 5 }),
        expect.stringContaining("ALARM"),
      );
    });
  });
});
