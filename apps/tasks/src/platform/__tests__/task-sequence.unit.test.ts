import { describe, expect, it } from "vitest";
import { runTasksInOrder } from "../task-sequence.ts";

describe("given several tasks in one invocation", () => {
  describe("when every one of them succeeds", () => {
    /** @scenario "Several task names in one invocation run in one process" */
    it("runs them in the order they were named", async () => {
      const ran: string[] = [];

      const code = await runTasksInOrder({
        names: ["prisma-migrate", "clickhouse-migrate", "lwql-provision"],
        args: [],
        runOne: ({ name }) => {
          ran.push(name);
          return Promise.resolve(0);
        },
      });

      expect(ran).toEqual(["prisma-migrate", "clickhouse-migrate", "lwql-provision"]);
      expect(code).toBe(0);
    });
  });

  describe("when the second one fails", () => {
    /** @scenario "The tasks run in the order named and stop at the first failure" */
    it("never runs the third and reports the failure", async () => {
      const ran: string[] = [];

      const code = await runTasksInOrder({
        names: ["prisma-migrate", "clickhouse-migrate", "lwql-provision"],
        args: [],
        runOne: ({ name }) => {
          ran.push(name);
          return Promise.resolve(name === "clickhouse-migrate" ? 1 : 0);
        },
      });

      expect(ran).toEqual(["prisma-migrate", "clickhouse-migrate"]);
      expect(code).toBe(1);
    });
  });

  describe("when one task carries arguments", () => {
    /** @scenario "Arguments still reach a single named task" */
    it("hands them to it untouched", async () => {
      const seen: Array<readonly string[]> = [];

      await runTasksInOrder({
        names: ["process-manager-purge"],
        args: ["--dry-run"],
        runOne: ({ args }) => {
          seen.push(args);
          return Promise.resolve(0);
        },
      });

      expect(seen).toEqual([["--dry-run"]]);
    });
  });
});
