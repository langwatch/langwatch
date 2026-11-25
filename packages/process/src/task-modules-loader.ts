/**
 * What a plugin task module exports: a ready array, or a factory over this process's own host.
 * Spec: specs/tasks/task-modules-loader.feature.
 */
export type TaskModuleExports<Host> = Readonly<{
  tasks?: readonly unknown[];
  createTasks?: (host: Host) => readonly unknown[];
}>;

/** Splits and trims `LANGWATCH_TASK_MODULES`; unset or blank loads nothing. */
export function parseTaskModuleSpecifiers(raw: string | undefined): readonly string[] {
  return (raw ?? "")
    .split(",")
    .map((specifier) => specifier.trim())
    .filter((specifier) => specifier.length > 0);
}

/**
 * Loads every named module's tasks, in the order named, for the launcher's catalogue. The
 * entry point passes its own `import()`: an env-named specifier cannot be a static import,
 * and the entry is where the linter allows one. Any failure names the module.
 */
export async function loadTaskModules<Task, Host>({
  specifiers,
  host,
  isTask,
  importModule,
}: {
  specifiers: readonly string[];
  host: Host;
  isTask: (value: unknown) => value is Task;
  importModule: (specifier: string) => Promise<unknown>;
}): Promise<Task[]> {
  const tasks: Task[] = [];
  for (const specifier of specifiers) {
    const exported = await importTaskModule<Host>({ specifier, importModule });
    tasks.push(...tasksOf({ specifier, exported, host, isTask }));
  }
  return tasks;
}

async function importTaskModule<Host>({
  specifier,
  importModule,
}: {
  specifier: string;
  importModule: (specifier: string) => Promise<unknown>;
}): Promise<TaskModuleExports<Host>> {
  try {
    return ((await importModule(specifier)) ?? {}) as TaskModuleExports<Host>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to import task module "${specifier}": ${reason}`, { cause: error });
  }
}

function tasksOf<Task, Host>({
  specifier,
  exported,
  host,
  isTask,
}: {
  specifier: string;
  exported: TaskModuleExports<Host>;
  host: Host;
  isTask: (value: unknown) => value is Task;
}): readonly Task[] {
  const source = exportedTasks({ exported, host });
  if (source === undefined) {
    throw new Error(
      `Task module "${specifier}" exports neither "tasks: Task[]" nor "createTasks(host): Task[]".`,
    );
  }
  const tasks: Task[] = [];
  for (const value of source.values) {
    if (!isTask(value)) {
      throw new Error(
        `Task module "${specifier}" exported a value from "${source.name}" that is not a Task.`,
      );
    }
    tasks.push(value);
  }
  return tasks;
}

function exportedTasks<Host>({
  exported,
  host,
}: {
  exported: TaskModuleExports<Host>;
  host: Host;
}): { name: string; values: readonly unknown[] } | undefined {
  if (Array.isArray(exported.tasks)) return { name: "tasks", values: exported.tasks };
  if (typeof exported.createTasks === "function") {
    return { name: "createTasks(host)", values: exported.createTasks(host) };
  }
  return undefined;
}
