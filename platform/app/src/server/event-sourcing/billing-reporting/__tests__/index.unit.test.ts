/**
 * Unit tests for `createBillingReportingPipeline`'s assembly: that the poke,
 * the sweep, and the command's own convergence loop all dispatch through one
 * shared `reportUsageForMonth` closure, and that the meter's store is wired
 * from the deps this factory receives.
 *
 * @see specs/licensing/billing-meter-dispatch.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMockLogger } = vi.hoisted(() => ({
  createMockLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: vi.fn(() => createMockLogger()),
}));

vi.mock("~/server/utils/ttlCache", () => ({
  TtlCache: class {
    async get() {
      return undefined;
    }
    async set() {
      return;
    }
  },
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
  withScope: vi.fn((cb: (scope: Record<string, unknown>) => void) =>
    cb({ setTag: vi.fn(), setExtra: vi.fn() }),
  ),
}));

vi.mock("~/server/organizations/resolveOrganizationId", () => ({
  resolveOrganizationId: vi.fn().mockResolvedValue("org-1"),
}));

import { createBillingReportingPipeline } from "..";

function makeDeps(
  overrides: Partial<Parameters<typeof createBillingReportingPipeline>[0]> = {},
) {
  return {
    organizations: {
      getOrganizationForBilling: vi.fn().mockResolvedValue(null),
    },
    billingCheckpoints: {
      getCheckpoint: vi.fn(),
      writeIntent: vi.fn(),
      confirm: vi.fn(),
      clearPendingAndIncrementFailures: vi.fn(),
      incrementFailures: vi.fn(),
    } as any,
    getUsageReportingService: () => undefined,
    queryBillableEventsTotal: vi.fn().mockResolvedValue(0) as any,
    getClickHouseClientForOrganization: vi.fn().mockResolvedValue(null),
    isSaas: true,
    ...overrides,
  };
}

describe("createBillingReportingPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes the meter's table and event types", () => {
    const pipeline = createBillingReportingPipeline(makeDeps());

    expect(pipeline.meter.table.name).toBe("billable_events");
    expect(pipeline.meter.eventTypes).toContain("lw.obs.trace.span_received");
  });

  it("exposes the debounce/dedup dispatch options unchanged", () => {
    const pipeline = createBillingReportingPipeline(makeDeps());

    expect(pipeline.dispatchOptions.deduplication.extend).toBe(false);
  });

  describe("given the poke mount and the sweep mount", () => {
    it("both dispatch through the same reportUsageForMonth closure", async () => {
      const getOrganizationForBilling = vi.fn().mockResolvedValue(null); // short-circuits before any Stripe call
      const pipeline = createBillingReportingPipeline(
        makeDeps({ organizations: { getOrganizationForBilling } }),
      );

      const poke = pipeline.createPokeMount(["lw.obs.trace.span_received"]);
      await poke.handle({ tenantId: "proj-1" });

      const sweep = pipeline.createSweepMount({
        listOrganizationsToReport: vi.fn().mockResolvedValue(["org-2"]),
        recordTick: vi.fn().mockResolvedValue(undefined),
        now: () => Date.UTC(2026, 1, 15),
      });
      await sweep.run();

      // Both paths reached the organization lookup inside reportUsageForMonth
      // — the one place both the poke and the sweep converge.
      expect(getOrganizationForBilling).toHaveBeenCalledWith("org-1"); // from the poke, via resolveOrganizationId
      expect(getOrganizationForBilling).toHaveBeenCalledWith("org-2"); // from the sweep, via listOrganizationsToReport
    });
  });

  describe("given a delta that must self-dispatch", () => {
    it("the self-dispatch loop calls back into the same organization/checkpoint pipeline, not a copy", async () => {
      const getOrganizationForBilling = vi.fn().mockResolvedValue({
        id: "org-1",
        stripeCustomerId: "cus_1",
        subscriptions: [{ id: "sub-1" }],
      });
      const getCheckpoint = vi
        .fn()
        // First attempt: healthy, triggers a transient failure and a self-dispatch.
        .mockResolvedValueOnce({
          lastReportedTotal: 0,
          pendingReportedTotal: null,
          consecutiveFailures: 0,
        })
        // Second attempt (the self-dispatch): the breaker is now tripped, so
        // THIS call no longer self-dispatches again once it fails too — it
        // still attempts Stripe (the fix's escape path; see
        // reportUsageForMonth.unit.test.ts for that behaviour in isolation),
        // and the mock's static rejection stops the chain here rather than
        // this test's mocks recursing forever.
        .mockResolvedValueOnce({
          lastReportedTotal: 0,
          pendingReportedTotal: null,
          consecutiveFailures: 5,
        });
      const queryBillableEventsTotal = vi.fn().mockResolvedValue(10);
      const reportUsageDelta = vi
        .fn()
        .mockRejectedValue(new Error("Stripe rate limit"));

      const pipeline = createBillingReportingPipeline(
        makeDeps({
          organizations: { getOrganizationForBilling },
          billingCheckpoints: {
            getCheckpoint,
            writeIntent: vi.fn(),
            confirm: vi.fn(),
            clearPendingAndIncrementFailures: vi.fn(),
            incrementFailures: vi.fn(),
          } as any,
          queryBillableEventsTotal,
          getUsageReportingService: () => ({
            reportUsageDelta,
            reportUsageSet: vi.fn(),
            getUsageSummary: vi.fn(),
          }),
        }),
      );

      await pipeline.reportUsageForMonth({
        organizationId: "org-1",
        billingMonth: "2026-02",
        tenantId: "org-1",
        occurredAt: Date.now(),
      });

      // A transient Stripe error self-dispatches for retry — reached only if
      // `selfDispatch` really points back at this pipeline's own
      // reportUsageForMonth rather than a no-op stub.
      expect(getOrganizationForBilling).toHaveBeenCalledTimes(2);
      expect(getCheckpoint).toHaveBeenCalledTimes(2);
    });
  });
});
