import { describe, expect, it } from "vitest";

import {
  canRunNow,
  compareForAttention,
  deriveLoopHealth,
  deriveStatus,
  latenessMs,
  needsAttention,
  type SchedulerJobLike,
  summarize,
} from "../model/scheduler-presentation.ts";

const NOW = new Date("2026-08-11T12:00:00.000Z").getTime();
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const job = (over: Partial<SchedulerJobLike> = {}): SchedulerJobLike => ({
  nextRunAt: at(600_000),
  lastSlot: at(-600_000),
  currentSlot: null,
  attempts: 0,
  active: true,
  ...over,
});

describe("deriveStatus", () => {
  describe("given a schedule whose next run is in the past", () => {
    describe("when its status is derived", () => {
      /** @scenario "An overdue schedule reads as overdue, not as a timestamp" */
      it("reads as overdue rather than as a timestamp", () => {
        expect(deriveStatus({ job: job({ nextRunAt: at(-2_520_000) }), now: NOW })).toBe("overdue");
      });

      it("states how late it is", () => {
        expect(latenessMs({ job: job({ nextRunAt: at(-2_520_000) }), now: NOW })).toBe(2_520_000);
      });
    });
  });

  describe("given a schedule a moment past due", () => {
    describe("when the loop is mid-claim", () => {
      it("is not called overdue yet", () => {
        // The loop leases a slot by pushing nextRunAt forward, so a row sits a
        // beat in the past during normal claiming.
        expect(deriveStatus({ job: job({ nextRunAt: at(-5_000) }), now: NOW })).toBe("scheduled");
      });
    });
  });

  describe("given a claimed slot", () => {
    describe("when there are no prior attempts", () => {
      it("reads as running", () => {
        expect(deriveStatus({ job: job({ currentSlot: at(-1_000) }), now: NOW })).toBe("running");
      });
    });

    describe("when prior attempts exist", () => {
      it("reads as retrying, not as a long-running execution", () => {
        expect(
          deriveStatus({
            job: job({ currentSlot: at(-1_000), attempts: 3 }),
            now: NOW,
          }),
        ).toBe("retrying");
      });
    });
  });

  describe("given an inactive schedule that is long past due", () => {
    describe("when its status is derived", () => {
      it("reads as paused rather than overdue", () => {
        // A switched-off schedule is not late; calling it overdue would bury
        // the schedules that genuinely are.
        expect(
          deriveStatus({
            job: job({ active: false, nextRunAt: at(-86_400_000) }),
            now: NOW,
          }),
        ).toBe("paused");
      });
    });
  });
});

describe("needsAttention", () => {
  it("flags overdue and retrying, and nothing else", () => {
    expect(needsAttention("overdue")).toBe(true);
    expect(needsAttention("retrying")).toBe(true);
    expect(needsAttention("running")).toBe(false);
    expect(needsAttention("scheduled")).toBe(false);
    expect(needsAttention("paused")).toBe(false);
  });
});

describe("compareForAttention", () => {
  describe("given overdue, retrying and healthy schedules", () => {
    describe("when the rows are sorted", () => {
      /** @scenario "Overdue and failing schedules sort above healthy ones" */
      it("puts the ones needing action first", () => {
        const rows = [
          job({ nextRunAt: at(60_000) }),
          job({ nextRunAt: at(-600_000) }),
          job({ currentSlot: at(-1_000), attempts: 2 }),
          job({ active: false }),
        ];

        const sorted = [...rows].toSorted((a, b) => compareForAttention({ a, b, now: NOW }));

        expect(sorted.map((r) => deriveStatus({ job: r, now: NOW }))).toEqual([
          "overdue",
          "retrying",
          "scheduled",
          "paused",
        ]);
      });
    });
  });

  describe("given two schedules of the same status", () => {
    it("orders the sooner one first", () => {
      const later = job({ nextRunAt: at(600_000) });
      const sooner = job({ nextRunAt: at(60_000) });

      expect([later, sooner].toSorted((a, b) => compareForAttention({ a, b, now: NOW }))[0]).toBe(
        sooner,
      );
    });
  });
});

describe("summarize", () => {
  describe("given a mix of schedules", () => {
    describe("when the header counts are derived", () => {
      /** @scenario "The header counts what needs attention" */
      it("counts overdue, failing, due-soon, active and paused", () => {
        const counts = summarize({
          jobs: [
            job({ nextRunAt: at(-600_000) }),
            job({ nextRunAt: at(-900_000) }),
            job({ currentSlot: at(-1_000), attempts: 4 }),
            job({ nextRunAt: at(720_000) }),
            job({ nextRunAt: at(7_200_000) }),
            job({ active: false }),
          ],
          now: NOW,
        });

        expect(counts.overdue).toBe(2);
        expect(counts.failing).toBe(1);
        expect(counts.dueWithinHour).toBe(1);
        expect(counts.active).toBe(5);
        expect(counts.paused).toBe(1);
      });
    });
  });

  describe("given nothing scheduled at all", () => {
    it("reports zeroes rather than throwing", () => {
      expect(summarize({ jobs: [], now: NOW })).toEqual({
        overdue: 0,
        failing: 0,
        dueWithinHour: 0,
        active: 0,
        paused: 0,
      });
    });
  });
});

describe("deriveLoopHealth", () => {
  describe("given schedules are overdue and nothing has fired in a long time", () => {
    describe("when loop health is derived", () => {
      /** @scenario "A stalled calendar loop is the headline, not a row detail" */
      it("reports the loop as unhealthy", () => {
        const health = deriveLoopHealth({
          jobs: [job({ nextRunAt: at(-600_000), lastSlot: at(-3_600_000) })],
          now: NOW,
        });

        expect(health.healthy).toBe(false);
        expect(health.lastFiredAt).toBe(NOW - 3_600_000);
      });
    });
  });

  describe("given schedules are overdue but something just fired", () => {
    it("does not blame the loop", () => {
      // Work IS being delivered, so an overdue row is that schedule's problem
      // rather than evidence the loop stopped.
      const health = deriveLoopHealth({
        jobs: [job({ nextRunAt: at(-600_000), lastSlot: at(-5_000) })],
        now: NOW,
      });

      expect(health.healthy).toBe(true);
    });
  });

  describe("given nothing is overdue", () => {
    it("treats silence as expected", () => {
      const health = deriveLoopHealth({
        jobs: [job({ nextRunAt: at(600_000), lastSlot: at(-86_400_000) })],
        now: NOW,
      });

      expect(health.healthy).toBe(true);
    });
  });

  describe("given an overdue schedule that has never fired", () => {
    it("reports the loop as unhealthy without a last-fired time", () => {
      const health = deriveLoopHealth({
        jobs: [job({ nextRunAt: at(-600_000), lastSlot: null })],
        now: NOW,
      });

      expect(health.healthy).toBe(false);
      expect(health.lastFiredAt).toBeNull();
    });
  });

  describe("given only paused schedules", () => {
    it("ignores them entirely", () => {
      const health = deriveLoopHealth({
        jobs: [job({ active: false, nextRunAt: at(-86_400_000) })],
        now: NOW,
      });

      expect(health.healthy).toBe(true);
      expect(health.lastFiredAt).toBeNull();
    });
  });
});

describe("canRunNow", () => {
  describe("given a schedule whose slot a worker has claimed", () => {
    /** @scenario "Run now is not offered while a run is in progress" */
    it("withholds run now while it is running", () => {
      // Re-arming a claimed slot hands the SAME slot to a second worker,
      // because claim() preserves an existing currentSlot rather than refusing.
      expect(canRunNow({ projectName: "Acme", status: "running" })).toBe(false);
    });

    it("withholds it while it is retrying too", () => {
      expect(canRunNow({ projectName: "Acme", status: "retrying" })).toBe(false);
    });
  });

  describe("given a paused schedule", () => {
    it("withholds run now, because pausing means nothing runs", () => {
      expect(canRunNow({ projectName: "Acme", status: "paused" })).toBe(false);
    });
  });

  describe("given a schedule whose project name could not be resolved", () => {
    it("withholds run now rather than confirming against a ksuid", () => {
      expect(canRunNow({ projectName: null, status: "scheduled" })).toBe(false);
    });
  });

  describe("given an idle schedule with a resolved project", () => {
    it("offers run now", () => {
      expect(canRunNow({ projectName: "Acme", status: "scheduled" })).toBe(true);
      expect(canRunNow({ projectName: "Acme", status: "overdue" })).toBe(true);
    });
  });
});
