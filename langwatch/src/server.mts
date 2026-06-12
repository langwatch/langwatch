import { setEnvironment } from "@langwatch/ksuid";
import dotenv from "dotenv";
import events from "events";
import Module from "module";

// `override: true` lets `.env` win over values that scripts/start.sh exported
// before this entry runs. start.sh defaults LW_GATEWAY_BASE_URL,
// LW_GATEWAY_PUBLIC_URL, LANGWATCH_API_URL etc. based on $PORT when those vars
// are unset in the shell — without override, dotenv.config() sees them as set
// and silently skips the .env value, so an explicit
// LW_GATEWAY_PUBLIC_URL=http://host.minikube.internal:5563 in .env never
// reaches the running process (and Langy can't reach the gateway from inside
// the OpenCode pod). NODE_ENV / PORT / similar process-level vars stay
// shell-only because .env shouldn't carry them.
dotenv.config({ override: true });
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
