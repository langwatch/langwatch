import { loadEnvConfig } from "@next/env";
import { createLogger } from "./utils/logger.server";
import fs from "fs";
import path from "path";

loadEnvConfig(process.cwd());

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { connection: redis } = require("./server/redis");

const logger = createLogger("langwatch:task");

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
    logger.info(`Running ${taskName}`);
    await script.default(...args.slice(1));
    logger.info(`Done!`);
  } catch (e) {
    logger.error(`SCRIPT RUNNER: failed to execute ${taskName}`);
    throw e;
  } finally {
    redis?.disconnect();
  }

  process.exit(0);
};

(async () => {
  await runAsync();
})().catch((err) => {
  console.error(err);
  throw err;
});
