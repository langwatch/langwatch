import { setEnvironment } from "@langwatch/ksuid";
import dotenv from "dotenv";
import events from "events";
import { existsSync } from "fs";
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
//
// dotenv's "injected env (N) from .env" line stays LOUD in local dev — it's the
// one confirmation of which env files actually loaded (and it prints before any
// logger exists; dotenv has no logger hook, only quiet). Prod and tests silence
// it: there it's a stray non-JSON stdout line on every boot.
const quiet = process.env.NODE_ENV !== "development";
dotenv.config({ override: true, quiet });
// Portless (haven) overlay: loaded LAST with override so the resolved hostname
// URLs + ports win over anything pinned in .env. In non-portless runs the file
// is absent and this is a no-op — and stays quiet, or dotenv would announce
// "injected env (0)" from a file that isn't there.
// See tools/thuishaven + ADR-048.
dotenv.config({
  path: ".env.portless",
  override: true,
  quiet: quiet || !existsSync(".env.portless"),
});
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

// Load OTel instrumentation before the app graph evaluates. instrumentation.node
// registers the tracer + OTLP exporters (traces/logs/metrics) and must run before
// any span-creating module imported by ./start. The Vite+Hono server has no
// Next.js instrumentation hook to do this, and under haven's single-process
// default the workers lane (workers.ts, which does the same import) never runs —
// so without this the API process exports no telemetry at all. Dynamic + after
// the dotenv.config() calls above so it reads the loaded .env/.env.portless
// (OTEL_EXPORTER_OTLP_ENDPOINT); it is a no-op when observability is unconfigured.
await import("./instrumentation.node");

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
