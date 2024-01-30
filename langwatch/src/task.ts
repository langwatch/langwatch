import { loadEnvConfig } from "@next/env";
import { getDebugger } from "./utils/logger";

loadEnvConfig(process.cwd());

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { connection: redis } = require("./server/redis");

const debug = getDebugger("langwatch:task");

const TASKS = {
  fixScheduledTraceChecks: require("./tasks/fixScheduledTraceChecks"),
  elasticIndexCreate: require("./tasks/elasticIndexCreate"),
  populateEmbeddings: require("./tasks/populateEmbeddings"),
  elasticReindex: require("./tasks/elasticReindex"),
  clearTopics: require("./tasks/clearTopics"),
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
  } finally {
    redis.disconnect();
  }
};

(async () => {
  await runAsync();
})().catch((err) => {
  console.error(err);
  throw err;
});
