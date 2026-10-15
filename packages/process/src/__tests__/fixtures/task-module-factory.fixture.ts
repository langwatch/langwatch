import { FixtureTask } from "./fixture-task.ts";

export function createTasks(host: { name: string }): FixtureTask[] {
  return [new FixtureTask(`fixture-create-tasks:${host.name}`)];
}
