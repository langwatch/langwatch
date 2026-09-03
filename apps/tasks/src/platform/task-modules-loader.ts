import { Task, TaskHostPort } from "@langwatch/task";

/**
 * What a saas (or other private) plugin module exports: exactly one of a
 * ready-made array, or a factory over this process's own `TaskHostPort` —
 * the same host the built-in catalogue's tasks get. Contract:
 * `dev/docs/plans/tasks-launch-interface-and-saas.md` Part 2.
 */
export type TaskModuleExports = {
  tasks?: readonly Task[];
  createTasks?: (host: TaskHostPort) => readonly Task[];
};

/**
 * Loads every module `LANGWATCH_TASK_MODULES` names and returns their
 * combined tasks, for the catalogue to merge with the built-in ones
 * (`TaskCatalogue.create` refuses a name collision on its own). The only
 * place in `apps/tasks` an inline `import()` is allowed: a specifier named
 * by an environment variable cannot be a static `import`.
 */
export async function loadTaskModules({
  specifiers,
  host,
}: {
  specifiers: readonly string[];
  host: TaskHostPort;
}): Promise<Task[]> {
  const tasks: Task[] = [];
  for (const specifier of specifiers) {
    tasks.push(...(await loadOneTaskModule({ specifier, host })));
  }
  return tasks;
}

/** Splits and trims `LANGWATCH_TASK_MODULES`; an unset or blank value loads nothing. */
export function parseTaskModuleSpecifiers(raw: string | undefined): readonly string[] {
  return (raw ?? "")
    .split(",")
    .map((specifier) => specifier.trim())
    .filter((specifier) => specifier.length > 0);
}

async function loadOneTaskModule({
  specifier,
  host,
}: {
  specifier: string;
  host: TaskHostPort;
}): Promise<readonly Task[]> {
  let moduleExports: TaskModuleExports;
  try {
    moduleExports = (await import(specifier)) as TaskModuleExports;
  } catch (error) {
    throw new Error(`Failed to import task module "${specifier}": ${describeError(error)}`, {
      cause: error,
    });
  }

  if (Array.isArray(moduleExports.tasks)) {
    return assertTasks({ specifier, tasks: moduleExports.tasks, source: "tasks" });
  }
  if (typeof moduleExports.createTasks === "function") {
    return assertTasks({
      specifier,
      tasks: moduleExports.createTasks(host),
      source: "createTasks(host)",
    });
  }
  throw new Error(
    `Task module "${specifier}" exports neither "tasks: Task[]" nor "createTasks(host): Task[]".`,
  );
}

function assertTasks({
  specifier,
  tasks,
  source,
}: {
  specifier: string;
  tasks: readonly unknown[];
  source: string;
}): readonly Task[] {
  for (const task of tasks) {
    if (!(task instanceof Task)) {
      throw new Error(
        `Task module "${specifier}" exported a value from "${source}" that is not a Task instance.`,
      );
    }
  }
  return tasks as readonly Task[];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
