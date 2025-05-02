import { loadEnvConfig } from "@next/env";
import { createLogger } from "./utils/logger";

loadEnvConfig(process.cwd());

const logger = createLogger("langwatch:workers");

logger.info("starting");

// eslint-disable-next-line @typescript-eslint/no-var-requires
require("./server/background/worker")
  .start(undefined, 5 * 60 * 1000)
  .catch((error: Error) => {
    logger.error({ error }, "error starting worker");
    process.exit(1);
  });
