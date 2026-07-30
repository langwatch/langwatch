import type { ProcessContext } from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import {
  BILLING_METER_SWEEP_INTERVAL_MS,
  BILLING_METER_SWEEP_PROCESS_NAME,
  type BillingMeterSweepPorts,
  billingMeterSweepIntents,
  billingMeterSweepOn,
  billingMeterSweepOnWake,
  initBillingMeterSweepState,
} from "../billingMeterSweep.process";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const ctx: ProcessContext = {
  processKey: "__global__",
  tenantId: "__global__",
  now: Date.UTC(2026, 6, 15),
};

function makePorts(
  overrides: Partial<BillingMeterSweepPorts> = {},
): BillingMeterSweepPorts {
  return {
    organizations: {
      getOrganizationForBilling: vi.fn().mockResolvedValue(undefined),
    },
    organizationCache: {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn(),
    },
    billingCheckpoints: {} as never,
    getUsageReportingService: () => undefined,
    queryBillableEventsTotal: vi.fn().mockResolvedValue(null),
    listOrganizationsToReport: vi.fn().mockResolvedValue([]),
    pruneDispatchedIntentsBefore: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe("billing meter sweep process", () => {
  describe("given the scheduled process wakes", () => {
    it("emits exactly one sweep intent keyed on the wake instant, re-arming every hour", () => {
      const wake = billingMeterSweepOnWake(initBillingMeterSweepState(), ctx);

      expect(wake).toEqual({
        state: {
          lastSweepAt: ctx.now,
          nextWakeAt: ctx.now + BILLING_METER_SWEEP_INTERVAL_MS,
        },
        intents: [{ type: "sweep", payload: { scheduledFor: ctx.now } }],
        nextWakeAt: ctx.now + BILLING_METER_SWEEP_INTERVAL_MS,
      });
    });
  });

  describe("given an event this global singleton does not act on", () => {
    it("leaves state and the armed wake untouched", () => {
      const armed = { lastSweepAt: 1_000, nextWakeAt: 4_600_000 };
      const step = billingMeterSweepOn.billableEventRecorded!(
        armed,
        {} as never,
        ctx,
      );

      expect(step).toEqual({
        state: armed,
        intents: [],
        nextWakeAt: 4_600_000,
      });
    });
  });

  /** @scenario Scheduled sweep re-reports usage without any new events */
  it("dispatches a fresh usage report for every organization with billable activity this month", async () => {
    const organizations = {
      getOrganizationForBilling: vi.fn().mockResolvedValue(undefined),
    };
    const listOrganizationsToReport = vi
      .fn()
      .mockResolvedValue(["org-1", "org-2"]);
    const ports = makePorts({ organizations, listOrganizationsToReport });

    await billingMeterSweepIntents(ports).sweep.deliver(
      { scheduledFor: Date.UTC(2026, 6, 15) },
      { now: ctx.now, tenantId: "__global__" },
    );

    expect(organizations.getOrganizationForBilling).toHaveBeenCalledWith(
      "org-1",
    );
    expect(organizations.getOrganizationForBilling).toHaveBeenCalledWith(
      "org-2",
    );
  });

  /** @scenario Scheduled sweep still closes the previous month during the grace window */
  it("lists and reports both months during the grace window", async () => {
    const listOrganizationsToReport = vi.fn().mockResolvedValue([]);
    const ports = makePorts({ listOrganizationsToReport });

    await billingMeterSweepIntents(ports).sweep.deliver(
      { scheduledFor: Date.UTC(2026, 6, 2) },
      { now: ctx.now, tenantId: "__global__" },
    );

    expect(listOrganizationsToReport).toHaveBeenCalledWith({
      billingMonth: "2026-06",
    });
    expect(listOrganizationsToReport).toHaveBeenCalledWith({
      billingMonth: "2026-07",
    });
  });

  describe("given one organization's report fails", () => {
    it("still attempts every other organization", async () => {
      const organizations = {
        getOrganizationForBilling: vi
          .fn()
          .mockImplementationOnce(() => Promise.reject(new Error("boom")))
          .mockResolvedValue(undefined),
      };
      const listOrganizationsToReport = vi
        .fn()
        .mockResolvedValue(["org-1", "org-2"]);
      const ports = makePorts({ organizations, listOrganizationsToReport });

      await expect(
        billingMeterSweepIntents(ports).sweep.deliver(
          { scheduledFor: Date.UTC(2026, 6, 15) },
          { now: ctx.now, tenantId: "__global__" },
        ),
      ).resolves.toBeUndefined();
      // `reportUsage` records a failure on the organization's own billing
      // checkpoint and returns, so the tick does not raise for this class and
      // the delta converges on the next poke or tick.
      expect(organizations.getOrganizationForBilling).toHaveBeenCalledTimes(2);
    });

    /** @scenario A sweep that cannot dispatch every report is retried */
    it("raises when it cannot even list which organizations to report", async () => {
      const listOrganizationsToReport = vi
        .fn()
        .mockRejectedValue(new Error("candidate query down"));
      const ports = makePorts({ listOrganizationsToReport });

      await expect(
        billingMeterSweepIntents(ports).sweep.deliver(
          { scheduledFor: Date.UTC(2026, 6, 15) },
          { now: ctx.now, tenantId: "__global__" },
        ),
      ).rejects.toThrow();
    });
  });

  /** @scenario A failure listing one month does not skip the other */
  it("still lists and dispatches the previous month when the current month's listing fails", async () => {
    const listOrganizationsToReport = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.reject(new Error("current month listing failed")),
      )
      .mockResolvedValueOnce([]);
    const ports = makePorts({ listOrganizationsToReport });

    await expect(
      billingMeterSweepIntents(ports).sweep.deliver(
        { scheduledFor: Date.UTC(2026, 6, 2) },
        { now: ctx.now, tenantId: "__global__" },
      ),
    ).rejects.toThrow();
    expect(listOrganizationsToReport).toHaveBeenCalledTimes(2);
  });

  describe("given the sweep's own dispatched outbox rows have accumulated", () => {
    it("prunes only its own rows older than a week", async () => {
      const pruneDispatchedIntentsBefore = vi.fn().mockResolvedValue(0);
      const ports = makePorts({ pruneDispatchedIntentsBefore });

      await billingMeterSweepIntents(ports).sweep.deliver(
        { scheduledFor: 10_000_000 },
        { now: ctx.now, tenantId: "__global__" },
      );

      expect(pruneDispatchedIntentsBefore).toHaveBeenCalledWith({
        processName: BILLING_METER_SWEEP_PROCESS_NAME,
        before: 10_000_000 - 7 * 24 * 60 * 60 * 1000,
      });
    });
  });
});
