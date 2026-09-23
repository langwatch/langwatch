import { TaskNotFoundError } from "./task.errors.ts";
import type { Task } from "./task.ts";

export class TaskCatalogue {
  private readonly tasksByName: ReadonlyMap<string, Task>;

  private constructor(tasksByName: ReadonlyMap<string, Task>) {
    this.tasksByName = tasksByName;
  }

  static create({ tasks }: { tasks: readonly Task[] }): TaskCatalogue {
    const byName = new Map<string, Task>();
    for (const task of tasks) {
      if (byName.has(task.name)) {
        throw new Error(`Duplicate task name "${task.name}" — task names must be unique`);
      }
      byName.set(task.name, task);
    }
    return new TaskCatalogue(byName);
  }

  get({ name }: { name: string }): Task {
    const task = this.tasksByName.get(name);
    if (!task) {
      throw new TaskNotFoundError({ task: name, availableNames: this.names() });
    }
    return task;
  }

  names(): readonly string[] {
    return [...this.tasksByName.keys()].toSorted();
  }
}
