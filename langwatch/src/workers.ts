import { loadEnvConfig } from "@next/env";
import { createLogger } from "./utils/logger";
import { WorkersRestart } from "./server/background/worker";

loadEnvConfig(process.cwd());

const logger = createLogger("langwatch:workers");

logger.info("starting");

// eslint-disable-next-line @typescript-eslint/no-var-requires
require("./server/background/worker")
  .start(undefined, 5 * 60 * 1000)
  .catch((error: Error) => {
    if (error instanceof WorkersRestart) {
      logger.info({ error }, "worker restart");
      process.exit(0);
    }

    logger.error({ error }, "error running worker");
    process.exit(1);
  });
