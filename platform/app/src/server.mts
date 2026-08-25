import events from "events";
import Module from "module";

// The executable side-effect boundary. Environment files, telemetry, and the
// application graph are loaded only after this function starts, so importing
// a config, feature, or route module cannot validate deployment configuration
// as an incidental module-evaluation effect.
void (async () => {
  const { loadEnvironment } = await import("./env-load");
  loadEnvironment();

  const { initializeEnvironmentConfig } = await import("./env.mjs");
  const environment = initializeEnvironmentConfig(process.env);

  const { setEnvironment } = await import("@langwatch/ksuid");
  const { AppBoot } = await import("./runtime/app/boot");

  setEnvironment(process.env.ENVIRONMENT ?? "local");

  if (process.env.NODE_ENV === "production") {
    process.setMaxListeners(128);
    events.EventEmitter.defaultMaxListeners = 128;
  }

  // CSS/SCSS/SASS are frontend-only. In dev (tsx) the server shares the app
  // graph, which transitively imports them, so stub them to a no-op.
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

  // Register the Grafana trace-link builder after the explicit environment
  // source has been selected.
  await import("./server/handled-error-wiring");

  // OTel must register before the app graph evaluates. This remains a dynamic
  // import so it observes the selected .env/.env.portless source.
  await import("./instrumentation.node");

  const appBoot = new AppBoot({
    compose: async (config, resources) => {
      // Keep all env-reading legacy imports behind the explicit config phase.
      const { createApp } = await import("./runtime/app");
      const { initializeInProcessApp, initializeWebApp } =
        await import("./server/app-layer/presets");
      const appRuntime = await createApp({
        initializeLegacy: config.workersInProcess
          ? initializeInProcessApp
          : initializeWebApp,
        resources,
      });
      const { startApp } = await import("./start");
      const { PublicAppConfigService } = await import("./runtime/public-config.server");
      const publicConfig = new PublicAppConfigService().resolve(environment);
      return {
        // startApp owns the single AppRuntime.start call and binds HTTP only
        // after the graph has initialized and passed its readiness checks.
        start: async () => {
          await startApp({ appRuntime, config, publicConfig });
        },
        close: () => appRuntime.close({ terminating: true }),
      };
    },
  });

  await appBoot.boot(process.env);
})().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[langwatch:server] fatal boot failure: ${message}\n`);
  process.exitCode = 1;
});
