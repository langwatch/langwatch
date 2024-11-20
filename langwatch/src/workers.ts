import { loadEnvConfig } from "@next/env";
import { getDebugger } from "./utils/logger";

loadEnvConfig(process.cwd());

const debug = getDebugger("langwatch:workers");

debug("Starting up workers");

// eslint-disable-next-line @typescript-eslint/no-var-requires
require("./server/background/worker")
  .start(undefined, 5 * 60 * 1000)
  .catch(() => {
    process.exit(1);
  });
