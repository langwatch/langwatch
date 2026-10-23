/** How many jobs a consumer runs at once as its throughput changes. specs/adaptive-slots.feature */
import { describe, expect, it } from "vitest";

import { AdaptiveSlots, MAX_SLOTS, type WorkSample } from "../adaptiveSlots.ts";

const IDLE = { loop: 0.3, heap: 0.4 };

/** A consumer fed one injected measurement per step. */
function consumerOf({ floor = 100 }: { floor?: number }) {
  const changes: number[] = [];
  let load = IDLE;
  let work: WorkSample | undefined;
  const slots = new AdaptiveSlots({
    floor,
    busy: () => floor,
    onChange: (next) => changes.push(next),
    readLoad: () => load,
    readWork: () => work,
  });
  return {
    slots,
    changes,
    loadIs: (next: { loop: number; heap: number }) => {
      load = next;
    },
    measure: (sample: Partial<WorkSample> = {}) => {
      work = {
        completedPerSecond: 100,
        medianDurationMs: 50,
        failureShare: 0,
        busyShare: 1,
        ...sample,
      };
      slots.adjust();
    },
  };
}

/** Grows from 100 to 157: one step, the straddling measurement, a judged gain and the next step. */
function grownConsumer() {
  const consumer = consumerOf({});
  consumer.measure({ completedPerSecond: 100 });
  consumer.measure({ completedPerSecond: 100 });
  consumer.measure({ completedPerSecond: 120 });
  consumer.measure({ completedPerSecond: 120 });
  return consumer;
}

describe("AdaptiveSlots", () => {
  describe("when every slot is taken and each step raises completed jobs per second", () => {
    /** @scenario "Slots grow by a quarter while each step raises completed jobs per second" */
    it("grows by a quarter after each judged step", () => {
      const { changes, measure } = consumerOf({});

      for (const completedPerSecond of [100, 0, 120, 0, 140, 0, 160]) {
        measure({ completedPerSecond });
      }

      expect(changes).toEqual([125, 157, 197, 247]);
    });
  });

  describe("when a growth step adds less than 5% throughput", () => {
    /** @scenario "A growth step that adds no throughput is undone and the count holds" */
    it("steps back to the count before the step and holds for 30 measurements", () => {
      const { slots, changes, measure } = consumerOf({});
      measure({ completedPerSecond: 100 });
      measure({ completedPerSecond: 100 });

      measure({ completedPerSecond: 104 });
      expect(changes).toEqual([125, 100]);

      for (let step = 0; step < 31; step += 1) measure({ completedPerSecond: 104 });
      expect(slots.current()).toBe(100);

      measure({ completedPerSecond: 104 });
      expect(changes).toEqual([125, 100, 125]);
    });
  });

  describe("when the median job duration doubles against its baseline", () => {
    /** @scenario "Job duration doubling without more throughput gives slots back" */
    it("shrinks by a fifth while throughput does not rise", () => {
      const { changes, measure } = grownConsumer();

      measure({ completedPerSecond: 100, medianDurationMs: 100 });

      expect(changes).toEqual([125, 157, 125]);
    });

    it("keeps the count while throughput rises with it", () => {
      const { slots, measure } = grownConsumer();

      measure({ completedPerSecond: 150, medianDurationMs: 100 });

      expect(slots.current()).toBeGreaterThanOrEqual(157);
    });
  });

  describe("when a tenth of finished jobs fail, twice the share before", () => {
    /** @scenario "Rising job failures give slots back" */
    it("shrinks by a fifth", () => {
      const { changes, measure } = grownConsumer();

      measure({ completedPerSecond: 150, failureShare: 0.1 });

      expect(changes).toEqual([125, 157, 125]);
    });
  });

  describe("when the event loop is near full", () => {
    /** @scenario "A busy event loop gives slots back down to the configured concurrency" */
    it("shrinks by a fifth down to the floor", () => {
      const { slots, changes, loadIs } = grownConsumer();
      loadIs({ loop: 0.98, heap: 0.4 });

      slots.adjust();
      slots.adjust();
      slots.adjust();

      expect(changes).toEqual([125, 157, 125, 100]);
      expect(slots.current()).toBe(100);
    });
  });

  describe("when the heap is above four fifths of its limit", () => {
    /** @scenario "A nearly full heap gives slots back down to the configured concurrency" */
    it("shrinks by a fifth down to the floor, though the loop is idle", () => {
      const { slots, changes, loadIs } = grownConsumer();
      loadIs({ loop: 0.3, heap: 0.85 });

      slots.adjust();
      slots.adjust();
      slots.adjust();

      expect(changes).toEqual([125, 157, 125, 100]);
    });
  });

  describe("when the event loop is over 85% busy", () => {
    /** @scenario "An event loop without room keeps the count" */
    it("keeps the count though throughput keeps rising", () => {
      const { changes, loadIs, measure } = consumerOf({});
      loadIs({ loop: 0.9, heap: 0.4 });

      for (const completedPerSecond of [100, 200, 300]) measure({ completedPerSecond });

      expect(changes).toEqual([]);
    });
  });

  describe("when slots sit free", () => {
    /** @scenario "Slots sitting free keep the count" */
    it("keeps the count", () => {
      const { slots, changes, measure } = consumerOf({});

      measure({ completedPerSecond: 100, busyShare: 0.5 });
      measure({ completedPerSecond: 200, busyShare: 0.5 });

      expect(changes).toEqual([]);
      expect(slots.current()).toBe(100);
    });
  });

  describe("when the configured concurrency is near 1000", () => {
    /** @scenario "Slots never grow past 1000" */
    it("stops at 1000", () => {
      const { slots, changes, measure } = consumerOf({ floor: 900 });

      for (const completedPerSecond of [100, 0, 200, 0, 300]) measure({ completedPerSecond });

      expect(changes).toEqual([MAX_SLOTS]);
      expect(slots.current()).toBe(1000);
    });

    it("keeps a configured concurrency above 1000 as configured", () => {
      const { slots, changes, measure } = consumerOf({ floor: 1200 });

      measure({ completedPerSecond: 100 });

      expect(changes).toEqual([]);
      expect(slots.current()).toBe(1200);
    });
  });

  describe("when the jobs report their duration and failures", () => {
    function reportingConsumer({ busy = 10_000 }: { busy?: number } = {}) {
      let clock = 0;
      const changes: number[] = [];
      const slots = new AdaptiveSlots({
        floor: 100,
        busy: () => busy,
        onChange: (next) => changes.push(next),
        readLoad: () => IDLE,
        now: () => clock,
      });
      const second = ({
        jobs,
        durationMs = 20,
        failed = 0,
      }: {
        jobs: number;
        durationMs?: number;
        failed?: number;
      }) => {
        for (let job = 0; job < jobs; job += 1) slots.jobFinished({ durationMs });
        for (let failure = 0; failure < failed; failure += 1) slots.jobFailed();
        clock += 1000;
        slots.adjust();
      };
      return { changes, second };
    }

    /** @scenario "Throughput is measured from the jobs that finished" */
    it("takes no measurement before 50 jobs finished, then one from them", () => {
      const { changes, second } = reportingConsumer();

      second({ jobs: 49 });
      expect(changes).toEqual([]);

      second({ jobs: 1 });
      expect(changes).toEqual([125]);
    });

    it("measures after ten steps however few jobs finished", () => {
      const { changes, second } = reportingConsumer();

      for (let step = 0; step < 9; step += 1) second({ jobs: 1 });
      expect(changes).toEqual([]);

      second({ jobs: 1 });
      expect(changes).toEqual([125]);
    });

    it("does not grow when most slots sat free as jobs finished", () => {
      const { changes, second } = reportingConsumer({ busy: 50 });

      second({ jobs: 100 });
      second({ jobs: 100 });

      expect(changes).toEqual([]);
    });

    it("counts the failed share of finished jobs", () => {
      const { changes, second } = reportingConsumer();
      second({ jobs: 100 });
      second({ jobs: 100 });

      second({ jobs: 100, failed: 10 });

      expect(changes).toEqual([125, 100]);
    });

    it("compares the median duration of finished jobs to its baseline", () => {
      const { changes, second } = reportingConsumer();
      second({ jobs: 100, durationMs: 20 });
      second({ jobs: 100, durationMs: 20 });

      second({ jobs: 100, durationMs: 40 });

      expect(changes).toEqual([125, 100]);
    });
  });
});
