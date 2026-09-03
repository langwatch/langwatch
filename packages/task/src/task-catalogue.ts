import type { Task } from "./task";
import { TaskNotFoundError } from "./task.errors";

/**
 * The one list a process's tasks live in: `apps/tasks/src/tasks.catalogue.ts`
 * builds one of these from every feature's exported task. A duplicate name
 * is refused at construction — two tasks racing for the same name is a
 * wiring bug, not something to resolve by last-write-wins.
 */
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
    return [...this.tasksByName.keys()].sort();
  }
}
