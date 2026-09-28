import { describe, expect, it } from "vitest";

import { orderFlows, runPool, width } from "../schedule";

const flow = (id: string, actions: string[]) => ({
  id,
  title: id,
  steps: actions.map((action) => ({ action })),
});

describe("Feature: visualdiff catches regressions and reports its own coverage", () => {
  describe("given twelve routes and four pages", () => {
    describe("when the side captures them", () => {
      /** @scenario A side captures its routes on several pages at once */
      it("runs four at a time and captures every route once", async () => {
        let running = 0;
        let peak = 0;
        const done: number[] = [];
        await runPool({
          items: Array.from({ length: 12 }, (_, index) => index),
          width: 4,
          work: async ({ item }) => {
            running += 1;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, 5));
            done.push(item);
            running -= 1;
          },
        });

        expect(peak).toBe(4);
        expect(done.toSorted((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i));
      });

      /** @scenario A side captures its routes on several pages at once */
      it("stops handing out routes once one lane fails", async () => {
        const started: number[] = [];
        const run = runPool({
          items: [0, 1, 2, 3, 4, 5],
          width: 2,
          work: async ({ item }) => {
            started.push(item);
            await new Promise((resolve) => setTimeout(resolve, 5));
            if (item === 0) throw new Error("the candidate's shell does not render");
          },
        });

        await expect(run).rejects.toThrow("shell does not render");
        expect(started.length).toBeLessThan(6);
      });
    });
  });

  describe("given a flow that edits the project settings", () => {
    /** @scenario Flows run side by side, and the one editing the project runs last */
    it("holds it back until the others are done", () => {
      const ordered = orderFlows([
        flow("project-settings", ["editProjectSettings"]),
        flow("prompt-create", ["createPrompt", "go"]),
        flow("trace-view", ["sendTrace", "openTrace"]),
      ]);

      expect(ordered.together.map((entry) => entry.id)).toEqual(["prompt-create", "trace-view"]);
      expect(ordered.last.map((entry) => entry.id)).toEqual(["project-settings"]);
      expect(width(undefined)).toBe(1);
      expect(width(3)).toBe(3);
    });
  });
});
