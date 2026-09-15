import { describe, expect, it } from "vitest";
import { parseTaskInvocation } from "../task-invocation.ts";

const known = ["prisma-migrate", "clickhouse-migrate", "lwql-provision", "process-manager-purge"];
const isTaskName = (name: string): boolean => known.includes(name);

describe("given an invocation of the task runner", () => {
  describe("when it names the three preparation tasks at once", () => {
    /** @scenario "Several task names in one invocation run in one process" */
    it("reads all three, in the order given, with nothing left over", () => {
      const invocation = parseTaskInvocation({
        argv: ["prisma-migrate", "clickhouse-migrate", "lwql-provision"],
        isTaskName,
      });

      expect(invocation.names).toEqual(["prisma-migrate", "clickhouse-migrate", "lwql-provision"]);
      expect(invocation.args).toEqual([]);
    });
  });

  describe("when it names one task followed by that task's arguments", () => {
    /** @scenario "Arguments still reach a single named task" */
    it("hands the arguments over untouched", () => {
      const invocation = parseTaskInvocation({
        argv: ["process-manager-purge", "--dry-run", "7"],
        isTaskName,
      });

      expect(invocation.names).toEqual(["process-manager-purge"]);
      expect(invocation.args).toEqual(["--dry-run", "7"]);
    });
  });

  describe("when it names several tasks and an argument", () => {
    /** @scenario "Arguments alongside several task names are refused" */
    it("refuses, because the argument belongs to none of them in particular", () => {
      expect(() =>
        parseTaskInvocation({
          argv: ["prisma-migrate", "clickhouse-migrate", "--dry-run"],
          isTaskName,
        }),
      ).toThrowError(/Arguments cannot be given alongside several task names/);
    });
  });

  describe("when it names something no task answers to", () => {
    /** @scenario "An unknown name is still reported against the catalogue" */
    it("passes the name through so the catalogue reports it", () => {
      const invocation = parseTaskInvocation({ argv: ["nonesuch", "--flag"], isTaskName });

      expect(invocation.names).toEqual(["nonesuch"]);
      expect(invocation.args).toEqual(["--flag"]);
    });

    /** @scenario "An unknown name is still reported against the catalogue" */
    it("passes an empty invocation through as well", () => {
      expect(parseTaskInvocation({ argv: [], isTaskName })).toEqual({ names: [], args: [] });
    });
  });
});
