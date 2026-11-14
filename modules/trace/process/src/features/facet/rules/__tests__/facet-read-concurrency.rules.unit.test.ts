/**
 * @vitest-environment node
 * A discovery pass runs its reads a few ClickHouse statements at a time, in order.
 * @see specs/traces-v2/search.feature
 */

import { describe, expect, it } from "vitest";

import { settleCapped } from "../facet-read-concurrency.rules.ts";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("settleCapped", () => {
  describe("when reads of 2, 1, 1, 2 and 1 statements run under a cap of 4", () => {
    /** @scenario "One facet discovery pass runs per tenant window at a time" */
    it("peaks at exactly 4 statements, starts them in order and answers in input order", async () => {
      const started: number[] = [];
      const answers: (() => void)[] = [];
      let running = 0;
      let peak = 0;
      const tasks = [2, 1, 1, 2, 1].map((statements, index) => ({
        statements,
        run: () =>
          new Promise<number>((resolve) => {
            started.push(index);
            running += statements;
            peak = Math.max(peak, running);
            answers[index] = () => {
              running -= statements;
              resolve(index);
            };
          }),
      }));

      const settling = settleCapped(tasks, 4);
      await settle();
      expect(started).toEqual([0, 1, 2]);

      answers[2]!();
      await settle();
      expect(started).toEqual([0, 1, 2]);

      answers[1]!();
      await settle();
      expect(started).toEqual([0, 1, 2, 3]);

      answers[0]!();
      await settle();
      answers[3]!();
      answers[4]!();

      expect(peak).toBe(4);
      expect(started).toEqual([0, 1, 2, 3, 4]);
      expect(await settling).toEqual(
        [0, 1, 2, 3, 4].map((value) => ({ status: "fulfilled", value })),
      );
    });
  });
});
