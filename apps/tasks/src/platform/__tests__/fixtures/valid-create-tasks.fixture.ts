import { Task, type TaskHostPort } from "@langwatch/task";

class FixtureHostTask extends Task {
  readonly name = "fixture-create-tasks";
  readonly description = "A fixture task built from the host handed to createTasks.";

  constructor(private readonly host: TaskHostPort) {
    super();
  }

  async run(): Promise<void> {
    void this.host;
  }
}

export function createTasks(host: TaskHostPort): Task[] {
  return [new FixtureHostTask(host)];
}
