// Worker executable boundary. Every runtime import that can reach the legacy
// app graph is deferred until the selected environment source has loaded and
// the narrow worker boot configuration has validated.
void (async () => {
  const { loadEnvironment } = await import("./env-load");
  loadEnvironment();

  const { initializeEnvironmentConfig } = await import("./env.mjs");
  initializeEnvironmentConfig(process.env);

  const { resolveProcessBootstrapConfig } = await import("./runtime/executable-bootstrap.config");
  const bootstrap = resolveProcessBootstrapConfig(process.env);
  const { configureLogger } = await import("@langwatch/observability");
  configureLogger(bootstrap.logger);

  const { AppBoot } = await import("./runtime/app/boot");
  const { AppBootConfigService, fixedAppBootConfigResolver } = await import("./runtime/config");
  const { setEnvironment } = await import("@langwatch/ksuid");
  const { createLogger } = await import("@langwatch/observability");
  const { installShutdownHandlers } = await import("./server/shutdown/runGracefulShutdown");
  const { SHUTDOWN_BUDGET } = await import("./server/shutdown/budget");

  setEnvironment(bootstrap.environment);

  // OTel instrumentation MUST load before any module that creates spans.
  const { initializeInstrumentation } = await import("./instrumentation.node");
  initializeInstrumentation(bootstrap.telemetry);
  await import("./server/handled-error-wiring");

  const logger = createLogger("langwatch:workers");
  logger.info("starting");

  let booted: { close(): Promise<void> } | undefined;

  installShutdownHandlers((signal) => ({
    signal,
    logger,
    phases: [
      {
        name: "worker-runtime",
        timeoutMs: SHUTDOWN_BUDGET.appCloseMs + 5_000,
        run: async () => await booted?.close(),
      },
    ],
  }));

  try {
    // Keep process-wide observability available when worker-only HTTP settings
    // reject boot, matching the former AppBoot.boot(process.env) timing.
    const appConfig = new AppBootConfigService().resolve(process.env);
    const appBoot = new AppBoot({
      config: fixedAppBootConfigResolver(appConfig),
      compose: async (_config, resources) => {
        // These imports are intentionally inside compose: config validation has
        // completed before the App composition or worker transport evaluate.
        const { WorkerRuntime } = await import("@langwatch/worker/runtime");
        const { createLegacyWorkerPorts } = await import("./runtime/worker/legacy-worker.adapter");
        const { initializeWorkerApp } = await import("./server/app-layer/presets");
        const app = initializeWorkerApp();
        const ports = createLegacyWorkerPorts(app);

        const runtime = WorkerRuntime.create({
          ...ports,
          resources,
        });

        return {
          start: () => runtime.start(),
          close: () => runtime.close(),
        };
      },
    });

    booted = await appBoot.boot({});
  } catch (error) {
    logger.error({ error }, "failed to start background workers");
    throw error;
  }

  process.on("uncaughtException", (err) => {
    logger.fatal({ error: err }, "uncaught exception detected");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.fatal(
      { reason: reason instanceof Error ? reason : { value: reason }, promise },
      "unhandled rejection detected",
    );
    process.exit(1);
  });
})().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[langwatch:workers] fatal boot failure: ${message}\n`);
  process.exit(1);
});
