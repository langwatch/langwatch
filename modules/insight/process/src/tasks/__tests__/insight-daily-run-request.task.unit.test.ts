/**
 * @vitest-environment node
 * The operator's task: one run asked for, for the project, the person and the board named.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import type { InsightApi, RequestInsightDailyRunInput } from "@langwatch/insight-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { InsightDailyRunRequestTask } from "../insight-daily-run-request.task.ts";

function harness() {
  const requested: RequestInsightDailyRunInput[] = [];
  const task = InsightDailyRunRequestTask.create({
    insights: createApiFixture<Pick<InsightApi, "requestDailyRun">>({
      requestDailyRun: async (input) => {
        requested.push(input);
        return { requestId: "request-1" };
      },
    }),
  });
  const run = (...args: string[]) => task.run({ args, signal: new AbortController().signal });
  return { task, run, requested };
}

describe("the insight-daily-run-request task", () => {
  describe("given an operator names a project, a person and a board", () => {
    /** @scenario "The operator task requests one run for a project, a person and a board" */
    it("requests one run for that person on that board", async () => {
      const { run, requested } = harness();

      await run("project-1", "user-1", "dashboard", "dashboard-1", "Costs", "5");

      expect(requested).toEqual([
        {
          projectId: "project-1",
          userId: "user-1",
          board: { kind: "dashboard", id: "dashboard-1", name: "Costs" },
          maxInsights: 5,
        },
      ]);
    });

    /** @scenario "The operator task requests one run for a project, a person and a board" */
    it.each([
      ["no argument", []],
      ["no person", ["project-1"]],
      ["no board", ["project-1", "user-1"]],
      ["no board id", ["project-1", "user-1", "dashboard"]],
      ["an unknown kind of board", ["project-1", "user-1", "saved-view", "view-1"]],
      [
        "a maximum that is no choice",
        ["project-1", "user-1", "dashboard", "dashboard-1", "Costs", "4"],
      ],
    ])("refuses a run with %s and requests nothing", async (_what, args) => {
      const { run, requested } = harness();

      await expect(run(...args)).rejects.toThrow("insight-daily-run-request <projectId>");
      expect(requested).toEqual([]);
    });

    it("names the board by its id and asks for 3 findings when neither is given", async () => {
      const { run, requested } = harness();

      await run("project-1", "user-1", "template", "llm-costs");

      expect(requested).toEqual([
        {
          projectId: "project-1",
          userId: "user-1",
          board: { kind: "template", id: "llm-costs", name: "llm-costs" },
          maxInsights: 3,
        },
      ]);
    });
  });

  it("is named for the tasks runner", () => {
    const { task } = harness();

    expect(task.name).toBe("insight-daily-run-request");
  });
});
