import { loadEnvConfig } from "@next/env";
import { getDebugger } from "./utils/logger";

loadEnvConfig(process.cwd());

const debug = getDebugger("langwatch:workers");

debug("Starting up workers");

// eslint-disable-next-line @typescript-eslint/no-var-requires
require("./server/background/worker").start()
