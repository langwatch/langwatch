import { setEnvironment } from "@langwatch/ksuid";
import dotenv from "dotenv";
import events from "events";

dotenv.config();
setEnvironment(process.env.ENVIRONMENT ?? "local");

if (process.env.NODE_ENV === "production") {
  process.setMaxListeners(128);
  events.EventEmitter.defaultMaxListeners = 128;
}

// Intentional inline dynamic import (exception to the "no inline import" rule):
// - `./start` must not evaluate until after dotenv.config() above has run,
//   because start.ts's transitive imports read process.env at module load.
//   A top-level static import would be hoisted above dotenv.config() and break
//   env loading.
// - `require("./start.js")` is also unsafe — that routes the load through the
//   CJS cache while other ESM consumers hit the ESM cache, causing a dual-module
//   instance of `./mcp/handler` and "Config not initialized" in production
//   (see 58be5207).
const { startApp } = await import("./start");
void startApp();
