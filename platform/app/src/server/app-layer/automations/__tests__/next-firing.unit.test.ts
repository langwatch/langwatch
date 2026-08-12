import { TriggerAction, TriggerKind } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { describeNextFiring, type NextFiringSubject } from "../next-firing";

const NOW = new Date("2026-08-12T12:03:20.000Z");

function subject(
  overrides: Partial<NextFiringSubject> = {},
): NextFiringSubject {
  return {
    triggerKind: TriggerKind.AUTOMATION,
    action: TriggerAction.SEND_SLACK_MESSAGE,
    customGraphId: null,
    notificationCadence: "immediate",
    traceDebounceMs: 30_000,
    active: true,
    ...overrides,
  };
}

describe("describeNextFiring", () => {
  describe("given a report", () => {
    describe("when the scheduler holds an active calendar entry", () => {
      it("reports the scheduler's own instant", () => {
        const nextRunAt = new Date("2026-08-13T09:00:00.000Z");

        const next = describeNextFiring({
          trigger: subject({ triggerKind: TriggerKind.REPORT }),
          reportSchedule: {
            triggerId: "trigger-1",
            nextRunAt,
            lastRunAt: null,
            active: true,
          },
          now: NOW,
        });

        expect(next).toEqual({
          kind: "schedule",
          nextRunAt,
          paused: false,
        });
      });
    });

    describe("when the schedule is deactivated", () => {
      it("claims no next run, even though the row still carries a stale one", () => {
        const next = describeNextFiring({
          trigger: subject({ triggerKind: TriggerKind.REPORT }),
          reportSchedule: {
            triggerId: "trigger-1",
            // `getReportSchedules` already nulls this for a paused entry; the
            // paused flag is asserted independently so a future read that
            // stops doing so cannot make the view promise a send.
            nextRunAt: null,
            lastRunAt: new Date("2026-08-11T09:00:00.000Z"),
            active: false,
          },
          now: NOW,
        });

        expect(next).toMatchObject({ kind: "schedule", paused: true });
      });
    });
  });

  describe("given a graph alert", () => {
    describe("when it is asked what happens next", () => {
      it("answers with the sweep cadence rather than an instant", () => {
        const next = describeNextFiring({
          trigger: subject({ customGraphId: "graph-1" }),
          reportSchedule: null,
          now: NOW,
        });

        expect(next).toEqual({ kind: "alert", sweepIntervalMs: 30_000 });
      });
    });
  });

  describe("given a trace automation on a digest cadence", () => {
    describe("when it is asked what happens next", () => {
      it("names the next wall-clock boundary the dispatcher would snap to", () => {
        const next = describeNextFiring({
          trigger: subject({ notificationCadence: "5min_digest" }),
          reportSchedule: null,
          now: NOW,
        });

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
        const next = describeNextFiring({
          trigger: subject({
            action: TriggerAction.ADD_TO_DATASET,
            notificationCadence: "hourly_digest",
          }),
          reportSchedule: null,
          now: NOW,
        });

        expect(next).toEqual({ kind: "immediate", traceDebounceMs: 30_000 });
      });
    });
  });

  describe("given a cadence value the platform does not recognise", () => {
    describe("when it is asked what happens next", () => {
      it("falls back to immediate, matching the dispatcher's own handling", () => {
        const next = describeNextFiring({
          trigger: subject({ notificationCadence: "fortnightly" }),
          reportSchedule: null,
          now: NOW,
        });

        expect(next).toMatchObject({ kind: "immediate" });
      });
    });
  });
});
