/**
 * Unit tests for the scheduled billing meter sweep — the durability guarantee
 * behind the per-event poke.
 *
 * @see specs/licensing/billing-meter-dispatch.feature "Usage Reporting — Scheduled Safety Net"
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BILLING_METER_SWEEP_PROCESS_NAME,
  type BillingMeterSweepDeps,
  type BillingMeterSweepState,
  billingMeterSweepWake,
  billingMonthsForSweep,
  runBillingMeterSweep,
} from "../billingMeterSweep.process";

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
    deleteDispatchedBefore: vi.fn().mockResolvedValue(0),
    now: vi.fn().mockReturnValue(MID_MONTH),
    ...overrides,
  } as MockedSweepDeps;
}

describe("billingMeterSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a scheduled wake", () => {
    /** @scenario "Scheduled sweep re-reports usage without any new events" */
    it("records the tick and emits exactly one sweep intent", () => {
      const sweep = vi.fn().mockReturnValue({ intent: "sweep" });

      const evolution = billingMeterSweepWake(
        { lastSweepAt: null } satisfies BillingMeterSweepState,
        {
          at: MID_MONTH,
          now: MID_MONTH,
          key: BILLING_METER_SWEEP_PROCESS_NAME,
          projectId: "scheduled",
          intents: { sweep } as never,
        },
      );

      expect(evolution.state).toEqual({ lastSweepAt: MID_MONTH });
      expect(evolution.intents).toHaveLength(1);
      expect(sweep).toHaveBeenCalledWith(`sweep:${MID_MONTH}`, {
        scheduledFor: MID_MONTH,
      });
    });
  });

  describe("given the sweep runs mid-month", () => {
    /** @scenario "Scheduled sweep re-reports usage without any new events" */
    it("dispatches a report for every candidate organization", async () => {
      const deps = makeDeps({
        listOrganizationsToReport: vi
          .fn()
          .mockResolvedValue(["org-1", "org-2"]),
      });

      await runBillingMeterSweep(deps)();

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

    it("prunes its own dispatched outbox rows", async () => {
      const deps = makeDeps();

      await runBillingMeterSweep(deps)();

      expect(deps.deleteDispatchedBefore).toHaveBeenCalledWith({
        processName: BILLING_METER_SWEEP_PROCESS_NAME,
        before: expect.any(Number),
      });
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
      // Retention is not skipped by the failure.
      expect(deps.deleteDispatchedBefore).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the candidate query fails", () => {
    /** @scenario "A sweep that cannot dispatch every report is retried" */
    it("raises so the outbox retries the whole tick", async () => {
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
      // The current month is listed first, so a blip there used to abort the
      // tick before the previous month — the one the grace window exists to
      // close out — was attempted at all.
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
    it("prunes its outbox rows even though the tick failed", async () => {
      const deps = makeDeps({
        now: () => FIRST_OF_MONTH,
        listOrganizationsToReport: vi
          .fn()
          .mockRejectedValue(new Error("candidate store unavailable")),
      });

      await expect(runBillingMeterSweep(deps)()).rejects.toThrow(
        "candidate store unavailable",
      );
      expect(deps.deleteDispatchedBefore).toHaveBeenCalledTimes(1);
    });
  });

  describe("given retention fails", () => {
    it("completes the tick anyway", async () => {
      const deps = makeDeps({
        deleteDispatchedBefore: vi
          .fn()
          .mockRejectedValue(new Error("retention unavailable")),
      });

      await expect(runBillingMeterSweep(deps)()).resolves.toBeUndefined();
      expect(deps.dispatchReport).toHaveBeenCalledTimes(1);
    });
  });
});
