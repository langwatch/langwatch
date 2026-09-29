import { serverModules as processModules } from "@langwatch/installed-server-modules";
import { createLogger } from "@langwatch/observability";
import { processConfig, Server } from "@langwatch/process-server";
import { scenarioChildBundle } from "@langwatch/scenario-child";
import { Task, TaskCatalogue } from "@langwatch/task";

import { processEnvironment } from "./config.ts";

const isTask = (contribution: unknown): contribution is Task => contribution instanceof Task;

/** Boots the modules in the tasks role and runs one declared task: main's `<name> <args…>`. */
export async function runModuleTask({
  name,
  args,
  signal,
}: {
  name: string;
  args: readonly string[];
  signal: AbortSignal;
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
    const app = await server
      .container("tasks")
      .withModules(processModules)
      .withMember("queue", () => void 0)
      .withMember("content", () => void 0)
      .withMember("gatewayInternalProtocol", () => ({}))
      .withMember("connectJudge", () => null)
      .withMember("scenarioChildBundle", () => scenarioChildBundle)
      .withMember("monitor", () => void 0)
      .withPipelines((pipelines) => pipelines.produce())
      .boot();
    await server.run(app);
    const catalogue = TaskCatalogue.create({ tasks: app.tasks(isTask) });
    const logger = createLogger("langwatch:tasks");
    signal.throwIfAborted();
    logger.info({ task: name }, "task starting");
    await catalogue.get({ name }).run({ args, signal });
    logger.info({ task: name }, "task finished");
  } finally {
    await server.close();
  }
}
