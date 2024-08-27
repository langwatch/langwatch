import { loadEnvConfig } from "@next/env";
import { getDebugger } from "./utils/logger";
import fs from "fs";
import path from "path";

loadEnvConfig(process.cwd());

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { connection: redis } = require("./server/redis");

const debug = getDebugger("langwatch:task");

const TASKS: Record<string, { default: (...args: any[]) => void }> = {};
const files = fs.readdirSync(path.join(__dirname, "./tasks"));
for (const file of files) {
  if (file.endsWith(".ts")) {
    const taskName = file.replace(".ts", "");
    TASKS[taskName] = require(`./tasks/${taskName}`);
  }
}

const args = process.argv.slice(2);

if (!args[0]) throw "Please specify a script to run";

const runAsync = async () => {
  const taskName = args[0] ?? "";
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
    throw e;
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
