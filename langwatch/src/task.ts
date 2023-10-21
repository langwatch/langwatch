import { loadEnvConfig } from "@next/env";
import { getDebugger } from "./utils/logger";

loadEnvConfig(process.cwd());

const debug = getDebugger("langwatch:task");

const TASKS = {
  elasticIndexCreate: require("./tasks/elasticIndexCreate"),
};

const args = process.argv.slice(2);

if (!args[0]) throw "Please specify a script to run";

const runAsync = async () => {
  const taskName = (args[0] ?? "") as keyof typeof TASKS;
  if (!Object.keys(TASKS).includes(taskName)) {
    throw "Task not found, check task.ts for all tasks available";
  }
  const script = TASKS[taskName] as {
    default: (...args: any[]) => Promise<void>;
  };

  try {
    debug(`Running ${taskName}`);
    await script.default(...args.slice(1));
    debug(`Done!`);
  } catch (e) {
    debug(`SCRIPT RUNNER: failed to execute ${taskName}`);
    debug(e);
  }
};

(async () => {
  await runAsync();
})().catch((err) => {
  console.error(err);
  throw err;
});
