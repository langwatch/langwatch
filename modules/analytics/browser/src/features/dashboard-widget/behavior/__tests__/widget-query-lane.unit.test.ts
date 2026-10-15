/**
 * The page's widget query lane: how many run at once, in what order the rest
 * start, and what an abort does to one still waiting.
 * @see specs/analytics/dashboard-widget-resilience.feature
 */

import { describe, expect, it } from "vitest";

import {
  createWidgetQueryLane,
  PAGE_WIDGET_QUERY_CONCURRENCY,
  pageWidgetQueryLane,
} from "../widget-query-lane.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Tasks that record when they start and finish only when told to. */
function gatedTasks() {
  const started: number[] = [];
  const finish: (() => void)[] = [];
  const task = (id: number) => () =>
    new Promise<number>((resolve) => {
      started.push(id);
      finish[id] = () => resolve(id);
    });
  return { started, finish, task };
}

describe("the widget query lane", () => {
  describe("when more queries are asked for than the page runs at a time", () => {
    /** @scenario "A dashboard does not send every widget query at once" */
    it("runs four at once and starts the rest, in order, as earlier ones finish", async () => {
      const { started, finish, task } = gatedTasks();
      const signal = new AbortController().signal;

      const results = Array.from({ length: 9 }, (_, id) =>
        pageWidgetQueryLane.run({ task: task(id), signal }),
      );
      await settle();
      expect(PAGE_WIDGET_QUERY_CONCURRENCY).toBe(4);
      expect(started).toEqual([0, 1, 2, 3]);

      finish[1]!();
      await settle();
      expect(started).toEqual([0, 1, 2, 3, 4]);

      for (let id = 0; id < 9; id += 1) {
        while (finish[id] === undefined) await settle();
        finish[id]!();
      }
      expect(await Promise.all(results)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it("frees the slot of a query that failed", async () => {
      const lane = createWidgetQueryLane({ limit: 1 });
      const signal = new AbortController().signal;

      const failed = lane.run({ task: () => Promise.reject(new Error("refused")), signal });
      const next = lane.run({ task: () => Promise.resolve("ran"), signal });

      await expect(failed).rejects.toThrow("refused");
      expect(await next).toBe("ran");
    });
  });

  describe("when a waiting query's frame is torn down", () => {
    /** @scenario "A dashboard does not send every widget query at once" */
    it("never starts it, and lets the one behind it through", async () => {
      const { started, finish, task } = gatedTasks();
      const lane = createWidgetQueryLane({ limit: 1 });
      const live = new AbortController();
      const gone = new AbortController();

      const first = lane.run({ task: task(0), signal: live.signal });
      const dropped = lane.run({ task: task(1), signal: gone.signal });
      const last = lane.run({ task: task(2), signal: live.signal });
      await settle();
      gone.abort(new Error("frame torn down"));
      await expect(dropped).rejects.toThrow("frame torn down");

      finish[0]!();
      await first;
      await settle();
      expect(started).toEqual([0, 2]);
      finish[2]!();
      expect(await last).toBe(2);
    });

    it("refuses one whose frame was already gone when it asked", async () => {
      const lane = createWidgetQueryLane({ limit: 1 });
      const gone = new AbortController();
      gone.abort(new Error("already gone"));
      let ran = false;

      const refused = lane.run({
        task: () => {
          ran = true;
          return Promise.resolve();
        },
        signal: gone.signal,
      });

      await expect(refused).rejects.toThrow("already gone");
      expect(ran).toBe(false);
    });
  });
});
