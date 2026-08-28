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
  initializeEnvironmentConfig(process.env);

  const { resolveProcessBootstrapConfig } = await import("./runtime/executable-bootstrap.config");
  const bootstrap = resolveProcessBootstrapConfig(process.env);
  const { configureLogger } = await import("@langwatch/observability");
  configureLogger(bootstrap.logger);

  const { setEnvironment } = await import("@langwatch/ksuid");
  const { AppBoot } = await import("./runtime/app/boot");
  const { AppBootConfigService, fixedAppBootConfigResolver } = await import("./runtime/config");

  setEnvironment(bootstrap.environment);

  if (bootstrap.nodeEnv === "production") {
    process.setMaxListeners(128);
    events.EventEmitter.defaultMaxListeners = 128;
  }

  // CSS/SCSS/SASS are frontend-only. In dev (tsx) the server shares the app
  // graph, which transitively imports them, so stub them to a no-op.
  if (bootstrap.nodeEnv === "development") {
    const noopCssPath = new URL("./noop-css.cjs", import.meta.url).pathname;
    const mod = Module as unknown as {
      _resolveFilename: (request: string, ...rest: unknown[]) => string;
    };
    const original = mod._resolveFilename;
    mod._resolveFilename = (request, ...rest) =>
      /\.(css|scss|sass)(\?.*)?$/.test(request) ? noopCssPath : original(request, ...rest);
  }

  // Register the Grafana trace-link builder after the explicit environment
  // source has been selected.
  await import("./server/handled-error-wiring");

  // OTel must register before the app graph evaluates. Resolve telemetry from
  // the selected .env/.env.portless source before loading the SDK module.
  const { initializeInstrumentation } = await import("./instrumentation.node");
  initializeInstrumentation(bootstrap.telemetry);

  // Preserve the original boundary: process-wide logging, IDs, and telemetry
  // are ready before HTTP-specific settings can reject application boot.
  const appConfig = new AppBootConfigService().resolve(process.env);
  const appBoot = new AppBoot({
    config: fixedAppBootConfigResolver(appConfig),
    compose: async (config, resources) => {
      // Keep all env-reading legacy imports behind the explicit config phase.
      const { createLegacyAppRuntime } = await import("./runtime/app");
      const { initializeInProcessApp, initializeWebApp } =
        await import("./server/app-layer/presets");
      const composeApp = config.workersInProcess ? initializeInProcessApp : initializeWebApp;
      const appRuntime = await createLegacyAppRuntime({
        composeApp,
        resources,
      });
      const { startApp } = await import("./start");
      // The projection subpath, not the barrel: `resolveUiPublicBootstrap`
      // reads server env, so it is deliberately kept off `./public-config`.
      // `.mts` sits outside the tsgo project, so getting this wrong fails at
      // boot rather than at compile time.
      const { resolveUiPublicBootstrap } = await import(
        "@langwatch/ui/public-config/projection"
      );
      const publicConfig = resolveUiPublicBootstrap(process.env).publicConfig;
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

  await appBoot.boot({});
})().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[langwatch:server] fatal boot failure: ${message}\n`);
  process.exitCode = 1;
});
