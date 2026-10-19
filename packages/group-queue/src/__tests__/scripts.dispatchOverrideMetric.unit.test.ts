import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GroupStagingScripts } from "../scripts.ts";

/**
 * The dispatch script returns `[flatResults, overrideDispatched]`. Driven
 * through a fake Redis because the number only earns its keep if it
 * survives that boundary — a parked and a starved backlog look alike without it.
 */

const QUEUE_NAME = "{pipeline/handler/spanStorage}";

/** One dispatched job in the script's flat 5-tuple layout; the last is its claim token. */
function jobTuple(id: string): string[] {
  return [id, `tenant-a/group-${id}`, JSON.stringify({ id }), "1000", `1000.${id}`];
}

function scriptsReturning(value: unknown): GroupStagingScripts {
  const redis = redisDouble({
    // CachedLuaScript sends EVALSHA; nothing else is reached in this path.
    evalsha: async () => value,
  });

  return new GroupStagingScripts(redis, QUEUE_NAME);
}

const OVERRIDE_TOTAL = "gq_jobs_dispatched_override_total";

let meter = createRecordingMeterProvider();

function overrideCount(): number {
  return meter.valueOf(OVERRIDE_TOTAL, { queue_name: QUEUE_NAME });
}

async function dispatch(scripts: GroupStagingScripts) {
  return scripts.dispatchBatch({
    nowMs: 1000,
    activeTtlSec: 30,
    maxJobs: 10,
  });
}

describe("dispatchBatch override accounting", () => {
  beforeEach(() => {
    meter = createRecordingMeterProvider();
    meter.install();
  });
  afterEach(() => meter.uninstall());

  describe("given the override filled otherwise-idle slots", () => {
    describe("when the batch is dispatched", () => {
      /** @scenario "Slots filled by the override are counted separately from ordinary dispatch" */
      it("counts the jobs the override admitted", async () => {
        const scripts = scriptsReturning([[...jobTuple("a"), ...jobTuple("b")], 2]);

        await dispatch(scripts);

        expect(overrideCount()).toBe(2);
      });

      /** @scenario "Slots filled by the override are counted separately from ordinary dispatch" */
      it("still returns every dispatched job, so none is lost to the accounting", async () => {
        const scripts = scriptsReturning([[...jobTuple("a"), ...jobTuple("b")], 2]);

        const dispatched = await dispatch(scripts);

        expect(dispatched.map((d) => d.stagedJobId)).toEqual(["a", "b"]);
      });
    });
  });

  describe("given the fleet was saturated so the override never ran", () => {
    describe("when the batch is dispatched", () => {
      /** @scenario "A saturated fleet records no override dispatches" */
      it("records no override dispatches", async () => {
        const scripts = scriptsReturning([[...jobTuple("a")], 0]);

        await dispatch(scripts);

        expect(overrideCount()).toBe(0);
      });

      /** @scenario "A saturated fleet records no override dispatches" */
      it("leaves the counter absent rather than reporting a zero series", async () => {
        const scripts = scriptsReturning([[...jobTuple("a")], 0]);

        await dispatch(scripts);

        expect(meter.valuesOf(OVERRIDE_TOTAL)).toEqual([]);
      });
    });
  });

  describe("given the script returned nothing usable", () => {
    describe("when the batch is dispatched", () => {
      /** @scenario "A saturated fleet records no override dispatches" */
      it("dispatches nothing and counts nothing", async () => {
        for (const value of [null, undefined, "unexpected", []]) {
          const dispatched = await dispatch(scriptsReturning(value));

          expect(dispatched).toEqual([]);
          expect(overrideCount()).toBe(0);
        }
      });

      /** @scenario "A saturated fleet records no override dispatches" */
      it("ignores a count that is not a number", async () => {
        const scripts = scriptsReturning([[...jobTuple("a")], "many"]);

        const dispatched = await dispatch(scripts);

        expect(dispatched).toHaveLength(1);
        expect(overrideCount()).toBe(0);
      });

      /** @scenario "A saturated fleet records no override dispatches" */
      it("ignores a count that arrives without the jobs it claims", async () => {
        const scripts = scriptsReturning([null, 2]);

        const dispatched = await dispatch(scripts);

        expect(dispatched).toEqual([]);
        expect(overrideCount()).toBe(0);
      });

      /** @scenario "A saturated fleet records no override dispatches" */
      it("ignores a count larger than the batch it rode in on", async () => {
        const scripts = scriptsReturning([[...jobTuple("a")], 5]);

        const dispatched = await dispatch(scripts);

        expect(dispatched).toHaveLength(1);
        expect(overrideCount()).toBe(0);
      });

      /** @scenario "A saturated fleet records no override dispatches" */
      it("dispatches nothing from a reply with partial tuples", async () => {
        const scripts = scriptsReturning([[...jobTuple("a"), "orphan-field"], 1]);

        const dispatched = await dispatch(scripts);

        expect(dispatched).toEqual([]);
        expect(overrideCount()).toBe(0);
      });
    });
  });
});
