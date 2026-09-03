import { describe, expect, it } from "vitest";
import { Task } from "../task";
import { TaskCatalogue } from "../task-catalogue";
import { TaskNotFoundError } from "../task.errors";

class StubTask extends Task {
  readonly name: string;
  readonly description = "a stub task";
  constructor(name: string) {
    super();
    this.name = name;
  }
  async run(): Promise<void> {}
}

describe("TaskCatalogue", () => {
  describe("given a set of uniquely named tasks", () => {
    it("resolves a task by name", () => {
      const catalogue = TaskCatalogue.create({ tasks: [new StubTask("alpha")] });
      expect(catalogue.get({ name: "alpha" })).toBeInstanceOf(StubTask);
    });

    it("lists every registered name, sorted", () => {
      const catalogue = TaskCatalogue.create({
        tasks: [new StubTask("beta"), new StubTask("alpha")],
      });
      expect(catalogue.names()).toEqual(["alpha", "beta"]);
    });
  });

  describe("when a name is not registered", () => {
    it("throws a task_not_found HandledError naming the available tasks", () => {
      const catalogue = TaskCatalogue.create({ tasks: [new StubTask("alpha")] });
      try {
        catalogue.get({ name: "missing" });
        expect.unreachable("expected TaskNotFoundError");
      } catch (error) {
        expect(error).toBeInstanceOf(TaskNotFoundError);
        expect((error as TaskNotFoundError).code).toBe("task_not_found");
        expect((error as TaskNotFoundError).meta.availableNames).toEqual(["alpha"]);
      }
    });
  });

  describe("when two tasks share a name", () => {
    it("refuses to construct the catalogue", () => {
      expect(() =>
        TaskCatalogue.create({ tasks: [new StubTask("alpha"), new StubTask("alpha")] }),
      ).toThrow(/Duplicate task name/);
    });
  });
});
