import { Task } from "@langwatch/task";

class FixtureTask extends Task {
  readonly name = "fixture-tasks-array";
  readonly description = "A fixture task exported as a plain array.";

  async run(): Promise<void> {}
}

export const tasks = [new FixtureTask()];
