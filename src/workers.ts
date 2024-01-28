// import { loadEnvConfig } from "@next/env";
// import { getDebugger } from "../langwatch/langwatch/src/utils/logger";

// loadEnvConfig(process.cwd());

// const debug = getDebugger("langwatch:workers");

// debug("Starting up workers");

// // eslint-disable-next-line @typescript-eslint/no-var-requires
// require("../langwatch/langwatch/src/server/background/worker").start();
require("../langwatch/langwatch/src/workers");
