import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { describeNextFiring, type NextFiringSubject } from "../next-firing.rules.ts";

const NOW = Temporal.Instant.from("2026-08-12T12:03:20.000Z");
const SWEEP_INTERVAL_MS = 30_000;

function subject(overrides: Partial<NextFiringSubject> = {}): NextFiringSubject {
  return {
    triggerKind: "AUTOMATION",
    action: "SEND_SLACK_MESSAGE",
    customGraphId: null,
    notificationCadence: "immediate",
    // Distinct from the sweep interval, so the alert case cannot pass on the debounce.
    traceDebounceMs: 45_000,
    active: true,
    pausedReason: null,
    ...overrides,
  };
}

function nextFiring({
  trigger,
  reportSchedule = null,
}: {
  trigger: NextFiringSubject;
  reportSchedule?: Parameters<typeof describeNextFiring>[0]["reportSchedule"];
}) {
  return describeNextFiring({
    trigger,
    reportSchedule,
    now: NOW,
    sweepIntervalMs: SWEEP_INTERVAL_MS,
  });
}

describe("describeNextFiring", () => {
  describe("given a report", () => {
    describe("when the scheduler holds an active calendar entry", () => {
      /** @scenario "The view shows the next scheduled firing" */
      it("reports the scheduler's own instant", () => {
        const nextRunAt = new Date("2026-08-13T09:00:00.000Z");

        const next = nextFiring({
          trigger: subject({ triggerKind: "REPORT" }),
          reportSchedule: { triggerId: "trigger_1", nextRunAt, lastRunAt: null, active: true },
        });

        expect(next).toEqual({ kind: "schedule", nextRunAt });
      });
    });

    describe("when the schedule is deactivated", () => {
      /** @scenario "A paused report does not claim a next firing" */
      it("claims no next run, even though the row still carries a stale one", () => {
        const next = nextFiring({
          trigger: subject({ triggerKind: "REPORT" }),
          reportSchedule: {
            triggerId: "trigger_1",
            // A stale instant on purpose: the paused flag has to win on its own.
            nextRunAt: new Date("2026-08-13T09:00:00.000Z"),
            lastRunAt: new Date("2026-08-11T09:00:00.000Z"),
            active: false,
          },
        });

        expect(next).toEqual({ kind: "paused", subject: "schedule", pausedReason: null });
      });
    });
  });

  describe("given an automation that is switched off", () => {
    describe("when it is a graph alert", () => {
      it("says nothing happens next, rather than quoting its cadence", () => {
        const next = nextFiring({ trigger: subject({ customGraphId: "graph_1", active: false }) });

        expect(next).toEqual({ kind: "paused", subject: "alert", pausedReason: null });
      });
    });

    describe("when it is a trace automation the platform paused", () => {
      it("carries the reason so the copy can say who paused it", () => {
        const next = nextFiring({
          trigger: subject({
            active: false,
            pausedReason: "runaway_volume",
            notificationCadence: "5min_digest",
          }),
        });

        expect(next).toEqual({
          kind: "paused",
          subject: "automation",
          pausedReason: "runaway_volume",
        });
      });
    });
  });

  describe("given a graph alert", () => {
    describe("when it is asked what happens next", () => {
      /** @scenario "A graph-watching automation says how often it is checked" */
      it("answers with the sweep cadence rather than an instant", () => {
        const next = nextFiring({ trigger: subject({ customGraphId: "graph_1" }) });

        expect(next).toEqual({ kind: "alert", sweepIntervalMs: SWEEP_INTERVAL_MS });
      });
    });
  });

  describe("given a trace automation on a digest cadence", () => {
    describe("when it is asked what happens next", () => {
      /** @scenario "A digest automation shows when its next window closes" */
      it("names the next wall-clock boundary the dispatcher would snap to", () => {
        const next = nextFiring({ trigger: subject({ notificationCadence: "5min_digest" }) });

        expect(next).toEqual({
          kind: "digest",
          cadence: "5min_digest",
          windowClosesAt: new Date("2026-08-12T12:05:00.000Z"),
        });
      });
    });
  });

  describe("given a persist action stored with a digest cadence", () => {
    describe("when it is asked what happens next", () => {
      it("reads as immediate, because that is what the dispatcher does with it", () => {
        const next = nextFiring({
          trigger: subject({ action: "ADD_TO_DATASET", notificationCadence: "hourly_digest" }),
        });

        expect(next).toEqual({ kind: "immediate", traceDebounceMs: 45_000 });
      });
    });
  });
});
