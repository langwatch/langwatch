import { TaskHostPort } from "@langwatch/task";
import { describe, expect, it } from "vitest";
import { loadTaskModules, parseTaskModuleSpecifiers } from "../task-modules-loader";

class TestTaskHost extends TaskHostPort {
  readonly prisma = undefined;
  readonly clickhouse = undefined;
  readonly redis = undefined;
  readonly objectStorage = undefined;
  readonly config = {};
}

const fixture = (name: string): string => new URL(`./fixtures/${name}`, import.meta.url).pathname;

describe("parseTaskModuleSpecifiers", () => {
  describe("when LANGWATCH_TASK_MODULES is unset or blank", () => {
    it("loads nothing", () => {
      expect(parseTaskModuleSpecifiers(undefined)).toEqual([]);
      expect(parseTaskModuleSpecifiers("")).toEqual([]);
      expect(parseTaskModuleSpecifiers("  ")).toEqual([]);
    });
  });

  describe("when given a comma-separated list", () => {
    it("trims each specifier and drops empty entries", () => {
      expect(parseTaskModuleSpecifiers(" a , b ,,c ")).toEqual(["a", "b", "c"]);
    });
  });
});

describe("loadTaskModules", () => {
  describe("given a module exporting tasks: Task[]", () => {
    /** @scenario "A plugin module exporting a plain task array loads" */
    it("returns its tasks", async () => {
      const tasks = await loadTaskModules({
        specifiers: [fixture("valid-tasks-array.fixture.ts")],
        host: new TestTaskHost(),
      });

      expect(tasks.map((task) => task.name)).toEqual(["fixture-tasks-array"]);
    });
  });

  describe("given a module exporting createTasks(host): Task[]", () => {
    /** @scenario "A plugin module exporting a host factory loads and receives this process's host" */
    it("calls the factory with the process's host and returns its tasks", async () => {
      const host = new TestTaskHost();

      const tasks = await loadTaskModules({
        specifiers: [fixture("valid-create-tasks.fixture.ts")],
        host,
      });

      expect(tasks.map((task) => task.name)).toEqual(["fixture-create-tasks"]);
    });
  });

  describe("given multiple modules", () => {
    /** @scenario "Tasks from every named module are merged in order" */
    it("merges every module's tasks", async () => {
      const tasks = await loadTaskModules({
        specifiers: [
          fixture("valid-tasks-array.fixture.ts"),
          fixture("valid-create-tasks.fixture.ts"),
        ],
        host: new TestTaskHost(),
      });

      expect(tasks.map((task) => task.name)).toEqual([
        "fixture-tasks-array",
        "fixture-create-tasks",
      ]);
    });
  });

  describe("given a module exporting neither shape", () => {
    /** @scenario "A module with no recognizable export fails boot naming itself" */
    it("throws naming the module", async () => {
      const specifier = fixture("invalid-shape.fixture.ts");

      await expect(
        loadTaskModules({ specifiers: [specifier], host: new TestTaskHost() }),
      ).rejects.toThrow(specifier);
    });
  });

  describe("given a module whose tasks array holds a non-Task value", () => {
    /** @scenario "A malformed task element fails boot naming the module" */
    it("throws naming the module", async () => {
      const specifier = fixture("non-task-array.fixture.ts");

      await expect(
        loadTaskModules({ specifiers: [specifier], host: new TestTaskHost() }),
      ).rejects.toThrow(specifier);
    });
  });

  describe("given a specifier that cannot be imported", () => {
    /** @scenario "An unresolvable module fails boot naming itself" */
    it("throws naming the module", async () => {
      const specifier = fixture("does-not-exist.fixture.ts");

      await expect(
        loadTaskModules({ specifiers: [specifier], host: new TestTaskHost() }),
      ).rejects.toThrow(specifier);
    });
  });

  describe("given no specifiers", () => {
    it("returns an empty list", async () => {
      const tasks = await loadTaskModules({ specifiers: [], host: new TestTaskHost() });

      expect(tasks).toEqual([]);
    });
  });
});
