// Env files (.env + the .env.portless haven overlay) load as this import's
// side effect, before any module that reads process.env at load time. Must
// stay the first import: see src/env-load.ts.
import "./env-load";

import { createLogger } from "@langwatch/observability";
import { tryGetApp } from "./server/app-layer/app";
import { TASKS } from "./tasks.generated";

const logger = createLogger("langwatch:task");

const args = process.argv.slice(2);

const runAsync = async () => {
  const taskName = args[0] ?? "";
  try {
    if (!taskName) {
      throw new Error("Please specify a task to run");
    }
    const load = TASKS[taskName];
    if (!load) {
      // Inside the try so the finally below still disconnects Redis — a bare
      // throw here used to leave the connection open and hang the process.
      throw new Error(
        `Task "${taskName}" not found. Available tasks: ${Object.keys(TASKS)
          .sort()
          .join(", ")}`,
      );
    }
    logger.info({ taskName }, "running");
    const script = await load();
    await script.default(...args.slice(1));
  } catch (e) {
    logger.error({ error: e, taskName }, "failed");
    throw e;
  } finally {
    // Only the tasks that initialize an App have anything open; closing it
    // releases Redis along with everything else the task booted. `tryGetApp`,
    // not `getApp`, because the question here is whether a task built one at
    // all — and most do not.
    await tryGetApp()?.close();
    logger.info("done");
  }

  process.exit(0);
};

(async () => {
  await runAsync();
})().catch((err) => {
  console.error(err);
  throw err;
});
