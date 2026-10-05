import { createLogger } from "@langwatch/observability";
import {
  loadTaskModules,
  parseTaskModuleSpecifiers,
  processConfig,
  Server,
} from "@langwatch/process";
import { Task, TaskCatalogue } from "@langwatch/task";

import { processEnvironment } from "./config.ts";
import { processModules } from "./process-modules.generated.ts";

const isTask = (contribution: unknown): contribution is Task => contribution instanceof Task;

/** Which plugin task modules to load, and the entry point's own `import()` to load them with. */
export interface TaskModulePlugins {
  /** The raw `LANGWATCH_TASK_MODULES` value; unset or blank loads nothing. */
  readonly taskModules: string | undefined;
  /** An env-named specifier cannot be a static import; only the entry may import it. */
  readonly importModule: (specifier: string) => Promise<unknown>;
}

/** Unreachable: with no plugins named, no specifier is ever imported. */
const refuseImport = (specifier: string): Promise<unknown> =>
  Promise.reject(new Error(`No task module loader was given for "${specifier}"`));

/**
 * Boots the modules in the tasks role and runs one declared task: main's `<name> <args…>`.
 * `LANGWATCH_TASK_MODULES` adds plugin tasks; a `createTasks(app)` gets the booted App (Alex,
 * 2026-10-05). Spec: specs/tasks/task-modules-loader.feature.
 */
export async function runModuleTask({
  name,
  args,
  signal,
  plugins,
}: {
  name: string;
  args: readonly string[];
  signal: AbortSignal;
  /** Absent loads no plugin module, as a run that names only an installed module's task. */
  plugins?: TaskModulePlugins;
}): Promise<void> {
  const server = await Server.create("langwatch-tasks")
    .withEnvironment(processEnvironment)
    .withConfig(processConfig(processModules))
    .withSecrets((config, secrets) =>
      secrets.withEnv().withFile().withOnePassword(config.process.onePasswordAccount),
    )
    .withProcessOwnership(false)
    .start();
  try {
    const app = await server.container("tasks").boot();
    await server.run(app);
    const loaded = await loadTaskModules({
      specifiers: parseTaskModuleSpecifiers(plugins?.taskModules),
      host: app,
      isTask,
      importModule: plugins?.importModule ?? refuseImport,
    });
    const catalogue = TaskCatalogue.create({ tasks: [...app.tasks(isTask), ...loaded] });
    const logger = createLogger("langwatch:tasks");
    signal.throwIfAborted();
    logger.info({ task: name }, "task starting");
    await catalogue.get({ name }).run({ args, signal });
    logger.info({ task: name }, "task finished");
  } finally {
    await server.close();
  }
}
