/**
 * Unit tests for the scheduled billing meter sweep — the durability
 * guarantee behind the per-event poke, and the piece this task calls out
 * explicitly as a SCHEDULED guarantee rather than a per-event one: every test
 * below drives `runBillingMeterSweep` directly off a clock (`now`), never off
 * an event.
 *
 * @see specs/licensing/billing-meter-dispatch.feature "A scheduled sweep guarantees the report even when nothing pokes"
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BILLING_METER_SWEEP_NAME,
  type BillingMeterSweepDeps,
  billingMonthsForSweep,
  createBillingMeterSweepMount,
  runBillingMeterSweep,
} from "../billingMeterSweep";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }),
}));

const MID_MONTH = Date.UTC(2026, 1, 15, 12, 0, 0); // 15 Feb 2026
const FIRST_OF_MONTH = Date.UTC(2026, 2, 1, 12, 0, 0); // 1 Mar 2026
const FOURTH_OF_MONTH = Date.UTC(2026, 2, 4, 12, 0, 0); // 4 Mar 2026

type MockedSweepDeps = {
  [K in keyof BillingMeterSweepDeps]: ReturnType<typeof vi.fn>;
} & BillingMeterSweepDeps;

function makeDeps(
  overrides: Partial<BillingMeterSweepDeps> = {},
): MockedSweepDeps {
  return {
    listOrganizationsToReport: vi.fn().mockResolvedValue(["org-1"]),
    dispatchReport: vi.fn().mockResolvedValue(undefined),
    recordTick: vi.fn().mockResolvedValue(undefined),
    now: vi.fn().mockReturnValue(MID_MONTH),
    ...overrides,
  } as MockedSweepDeps;
}

describe("runBillingMeterSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the sweep's hourly schedule wakes it, with no new events", () => {
    /** @scenario "Scheduled sweep re-reports usage without any new events" */
    it("records the tick once and dispatches a fresh report for every candidate organization", async () => {
      const deps = makeDeps({
        listOrganizationsToReport: vi
          .fn()
          .mockResolvedValue(["org-1", "org-2"]),
      });

      await runBillingMeterSweep(deps)();

      expect(deps.recordTick).toHaveBeenCalledTimes(1);
      expect(deps.dispatchReport).toHaveBeenCalledTimes(2);
      expect(deps.dispatchReport).toHaveBeenCalledWith({
        organizationId: "org-1",
        billingMonth: "2026-02",
        tenantId: "org-1",
        occurredAt: MID_MONTH,
      });
      expect(deps.dispatchReport).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org-2" }),
      );
    });

    it("sweeps only the current month past the grace window", async () => {
      const deps = makeDeps({ now: () => FOURTH_OF_MONTH });

      await runBillingMeterSweep(deps)();

      expect(billingMonthsForSweep(new Date(FOURTH_OF_MONTH))).toEqual([
        "2026-03",
      ]);
      expect(deps.dispatchReport).toHaveBeenCalledTimes(1);
      expect(deps.dispatchReport).toHaveBeenCalledWith(
        expect.objectContaining({ billingMonth: "2026-03" }),
      );
    });
  });

  describe("given the sweep runs inside the grace window", () => {
    /** @scenario "Scheduled sweep still closes the previous month during the grace window" */
    it("dispatches for the previous month as well as the current one", async () => {
      const deps = makeDeps({ now: () => FIRST_OF_MONTH });

      await runBillingMeterSweep(deps)();

      expect(deps.dispatchReport).toHaveBeenCalledWith(
        expect.objectContaining({ billingMonth: "2026-03" }),
      );
      expect(deps.dispatchReport).toHaveBeenCalledWith(
        expect.objectContaining({ billingMonth: "2026-02" }),
      );
    });
  });

  describe("given one organization's dispatch fails", () => {
    /** @scenario "A sweep that cannot dispatch every report is retried" */
    it("still dispatches the others and then raises for retry", async () => {
      const dispatchReport = vi
        .fn()
        .mockRejectedValueOnce(new Error("queue unavailable"))
        .mockResolvedValue(undefined);
      const deps = makeDeps({
        listOrganizationsToReport: vi
          .fn()
          .mockResolvedValue(["org-1", "org-2"]),
        dispatchReport,
      });

      await expect(runBillingMeterSweep(deps)()).rejects.toThrow(
        /failed to dispatch 1 of 2/,
      );

      expect(dispatchReport).toHaveBeenCalledTimes(2);
      // Tick bookkeeping is not skipped by the failure.
      expect(deps.recordTick).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the candidate query fails entirely", () => {
    /** @scenario "A sweep that cannot dispatch every report is retried" */
    it("raises so the tick is retried", async () => {
      const deps = makeDeps({
        listOrganizationsToReport: vi
          .fn()
          .mockRejectedValue(new Error("database unavailable")),
      });

      await expect(runBillingMeterSweep(deps)()).rejects.toThrow(
        "database unavailable",
      );
      expect(deps.dispatchReport).not.toHaveBeenCalled();
    });
  });

  describe("given the candidate query fails for one month inside the grace window", () => {
    /** @scenario "A failure listing one month does not skip the other" */
    it("still sweeps the other month, then raises for retry", async () => {
      // The current month is listed first, so a blip there must not abort the
      // tick before the previous month — the one the grace window exists to
      // close out — is attempted at all.
      const listOrganizationsToReport = vi
        .fn()
        .mockImplementation(
          async ({ billingMonth }: { billingMonth: string }) => {
            if (billingMonth === "2026-03") {
              throw new Error("candidate store unavailable");
            }
            return ["org-late"];
          },
        );
      const deps = makeDeps({
        now: () => FIRST_OF_MONTH,
        listOrganizationsToReport,
      });

      await expect(runBillingMeterSweep(deps)()).rejects.toThrow(
        "candidate store unavailable",
      );

      expect(listOrganizationsToReport).toHaveBeenCalledTimes(2);
      expect(deps.dispatchReport).toHaveBeenCalledTimes(1);
      expect(deps.dispatchReport).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-late",
          billingMonth: "2026-02",
        }),
      );
    });

    /** @scenario "A failure listing one month does not skip the other" */
    it("records the tick even though the tick failed", async () => {
      const deps = makeDeps({
        now: () => FIRST_OF_MONTH,
        listOrganizationsToReport: vi
          .fn()
          .mockRejectedValue(new Error("candidate store unavailable")),
      });

      await expect(runBillingMeterSweep(deps)()).rejects.toThrow(
        "candidate store unavailable",
      );
      expect(deps.recordTick).toHaveBeenCalledTimes(1);
    });
  });

  describe("given tick bookkeeping fails", () => {
    it("completes the tick anyway", async () => {
      const deps = makeDeps({
        recordTick: vi
          .fn()
          .mockRejectedValue(new Error("bookkeeping unavailable")),
      });

      await expect(runBillingMeterSweep(deps)()).resolves.toBeUndefined();
      expect(deps.dispatchReport).toHaveBeenCalledTimes(1);
    });
  });
});

describe("createBillingMeterSweepMount", () => {
  it("names itself and carries the hourly interval", () => {
    const mount = createBillingMeterSweepMount(makeDeps());

    expect(mount.name).toBe(BILLING_METER_SWEEP_NAME);
    expect(mount.intervalMs).toBe(60 * 60 * 1000);
  });

  it("runs the same sweep logic through run()", async () => {
    const deps = makeDeps();
    const mount = createBillingMeterSweepMount(deps);

    await mount.run();

    expect(deps.dispatchReport).toHaveBeenCalledTimes(1);
  });
});
