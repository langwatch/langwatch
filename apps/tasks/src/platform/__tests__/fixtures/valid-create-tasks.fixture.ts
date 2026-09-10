import { Task, type TaskHost } from "@langwatch/task";

class FixtureHostTask extends Task {
  readonly name = "fixture-create-tasks";
  readonly description = "A fixture task built from the host handed to createTasks.";

  constructor(private readonly host: TaskHost) {
    super();
  }

  async run(): Promise<void> {
    void this.host;
  }
}

export function createTasks(host: TaskHost): Task[] {
  return [new FixtureHostTask(host)];
}
