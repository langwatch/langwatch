import { setEnvironment } from "@langwatch/ksuid";
import dotenv from "dotenv";
import events from "events";
import Module from "module";

dotenv.config();
setEnvironment(process.env.ENVIRONMENT ?? "local");

if (process.env.NODE_ENV === "production") {
  process.setMaxListeners(128);
  events.EventEmitter.defaultMaxListeners = 128;
}

// Register a no-op handler for CSS/SCSS/SASS files.
// Server-side code shares modules with the frontend (via tRPC routers,
// shared types, etc.) that transitively import CSS — these must be
// silently ignored on the server since there's no bundler to handle them.
const noopCssPath = new URL("./noop-css.cjs", import.meta.url).pathname;
const originalResolveFilename = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (
  request: string,
  parent: any,
  isMain: boolean,
  options: any,
) {
  if (/\.(css|scss|sass)(\?.*)?$/.test(request)) {
    return noopCssPath;
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

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
