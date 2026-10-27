import { describe, expect, it, vi } from "vitest";

import { loadTaskModules, parseTaskModuleSpecifiers } from "../task-modules-loader.ts";
import { FixtureTask } from "./fixtures/fixture-task.ts";

const fixture = (name: string): string =>
  new URL(`./fixtures/${name}.fixture.ts`, import.meta.url).pathname;
const isTask = (value: unknown): value is FixtureTask => value instanceof FixtureTask;
const host = { name: "this-process" };

function load(specifiers: readonly string[]) {
  return loadTaskModules({
    specifiers,
    host,
    isTask,
    importModule: (specifier) => import(specifier),
  });
}

describe("parseTaskModuleSpecifiers", () => {
  describe("when LANGWATCH_TASK_MODULES is unset or blank", () => {
    it("names no module", () => {
      expect(parseTaskModuleSpecifiers(undefined)).toEqual([]);
      expect(parseTaskModuleSpecifiers("  ")).toEqual([]);
    });
  });

  describe("when it is a comma-separated list", () => {
    it("trims each specifier and drops empty entries", () => {
      expect(parseTaskModuleSpecifiers(" a , b ,,c ")).toEqual(["a", "b", "c"]);
    });
  });
});

describe("loadTaskModules", () => {
  describe("given a module that exports tasks: Task[]", () => {
    /** @scenario A plugin module exporting a plain task array loads */
    it("returns its tasks", async () => {
      const tasks = await load([fixture("task-module-array")]);

      expect(tasks.map((task) => task.name)).toEqual(["fixture-tasks-array"]);
    });
  });

  describe("given a module that exports createTasks(host): Task[]", () => {
    /** @scenario A plugin module exporting a host factory loads and receives this process's host */
    it("calls the factory with the host it was given and returns its tasks", async () => {
      const tasks = await load([fixture("task-module-factory")]);

      expect(tasks.map((task) => task.name)).toEqual(["fixture-create-tasks:this-process"]);
    });
  });

  describe("given several named modules", () => {
    /** @scenario Tasks from every named module are merged in order */
    it("merges every module's tasks in the order they were named", async () => {
      const specifiers = parseTaskModuleSpecifiers(
        `${fixture("task-module-factory")},${fixture("task-module-array")}`,
      );

      const tasks = await load(specifiers);

      expect(tasks.map((task) => task.name)).toEqual([
        "fixture-create-tasks:this-process",
        "fixture-tasks-array",
      ]);
    });
  });

  describe("given a module that exports neither shape", () => {
    /** @scenario A module with no recognizable export fails boot naming itself */
    it("throws naming the module", async () => {
      const specifier = fixture("task-module-neither");

      await expect(load([specifier])).rejects.toThrow(specifier);
    });
  });

  describe("given a module whose tasks array holds a value that is not a Task", () => {
    /** @scenario A malformed task element fails boot naming the module */
    it("throws naming the module", async () => {
      const specifier = fixture("task-module-not-a-task");

      await expect(load([specifier])).rejects.toThrow(specifier);
    });
  });

  describe("given a specifier that cannot be imported", () => {
    /** @scenario An unresolvable module fails boot naming itself */
    it("throws naming the module", async () => {
      const specifier = fixture("task-module-missing");

      await expect(load([specifier])).rejects.toThrow(specifier);
    });
  });

  describe("given no specifiers", () => {
    it("imports nothing", async () => {
      const importModule = vi.fn();

      await expect(
        loadTaskModules({ specifiers: [], host, isTask, importModule }),
      ).resolves.toEqual([]);
      expect(importModule).not.toHaveBeenCalled();
    });
  });
});
