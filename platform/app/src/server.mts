// Env files (.env + the .env.portless haven overlay) load as this import's
// side effect, before every other import here. See src/env-load.ts for the
// override semantics and why the load lives in a module of its own.
import "./env-load";

import { setEnvironment } from "@langwatch/ksuid";
import events from "events";
import Module from "module";

// Registers the Grafana trace-link builder with @langwatch/handled-error.
// Registration only stores a function (env is read per serialize()), so a
// static import is safe even before the app graph loads.
import "./server/handled-error-wiring";

setEnvironment(process.env.ENVIRONMENT ?? "local");

if (process.env.NODE_ENV === "production") {
  process.setMaxListeners(128);
  events.EventEmitter.defaultMaxListeners = 128;
}

// CSS/SCSS/SASS are frontend-only. In dev (tsx) the server shares the app graph,
// which transitively imports them, so stub them to a no-op — there is no runtime
// bundler. The prod bundle resolves them to empty at build time, so it skips this.
if (process.env.NODE_ENV === "development") {
  const noopCssPath = new URL("./noop-css.cjs", import.meta.url).pathname;
  const mod = Module as unknown as {
    _resolveFilename: (request: string, ...rest: unknown[]) => string;
  };
  const original = mod._resolveFilename;
  mod._resolveFilename = (request, ...rest) =>
    /\.(css|scss|sass)(\?.*)?$/.test(request)
      ? noopCssPath
      : original(request, ...rest);
}

// Wrapped in an async IIFE rather than top-level await so this entry can be
// bundled as CommonJS (CJS has no TLA). env-load above runs synchronously
// first, so the ordering these dynamic imports depend on holds.
void (async () => {
  // Load OTel instrumentation before the app graph evaluates. instrumentation.node
  // registers the tracer + OTLP exporters (traces/logs/metrics) and must run before
  // any span-creating module imported by ./start. The Vite+Hono server has no
  // Next.js instrumentation hook to do this, and under haven's single-process
  // default the workers lane (workers.ts, which does the same import) never runs —
  // so without this the API process exports no telemetry at all. It runs after
  // env-load above, so it reads the loaded .env/.env.portless
  // (OTEL_EXPORTER_OTLP_ENDPOINT); it is a no-op when observability is unconfigured.
  await import("./instrumentation.node");

  // Intentional inline dynamic import (exception to the "no inline import" rule):
  // - `./start` must not evaluate until env-load above has run, because
  //   start.ts's transitive imports read process.env at module load.
  // - `require("./start.js")` is also unsafe — that routes the load through the
  //   CJS cache while other ESM consumers hit the ESM cache, causing a dual-module
  //   instance of `./mcp/handler` and "Config not initialized" in production
  //   (see 58be5207).
  const { startApp } = await import("./start");
  void startApp();
})();
