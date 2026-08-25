// Worker executable boundary. Every runtime import that can reach the legacy
// app graph is deferred until the selected environment source has loaded and
// the narrow worker boot configuration has validated.
void (async () => {
  const { loadEnvironment } = await import("./env-load");
  loadEnvironment();

  const { initializeEnvironmentConfig } = await import("./env.mjs");
  initializeEnvironmentConfig(process.env);

  const { AppBoot } = await import("./runtime/app/boot");
  const { setEnvironment } = await import("@langwatch/ksuid");
  const { createLogger } = await import("@langwatch/observability");
  const { installShutdownHandlers } = await import(
    "./server/shutdown/runGracefulShutdown"
  );
  const { SHUTDOWN_BUDGET } = await import("./server/shutdown/budget");

  setEnvironment(process.env.ENVIRONMENT ?? "local");

  // OTel instrumentation MUST load before any module that creates spans.
  await import("./instrumentation.node");
  await import("./server/handled-error-wiring");

  const logger = createLogger("langwatch:workers");
  logger.info("starting");

  let booted:
    | { close(): Promise<void> }
    | undefined;

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

  const appBoot = new AppBoot({
    compose: async (_config, resources) => {
      // These imports are intentionally inside compose: config validation has
      // completed before the App composition or worker transport evaluate.
      const { createWorker } = await import("./runtime/worker");
      const { startWorkers } = await import("./server/workers/startWorkers");
      const { initializeWorkerApp } = (await import(
        "./server/app-layer/presets"
      )) as {
        initializeWorkerApp: () => import("./server/app-layer/app").App;
      };

      const runtime = await createWorker({
        composeApp: initializeWorkerApp,
        startWorker: (app) =>
          startWorkers({ shouldStartMetricsServer: true, app }),
        resources,
        ownsResources: false,
      });

      return {
        start: () => runtime.start(),
        close: () => runtime.close(),
      };
    },
  });

  try {
    booted = await appBoot.boot(process.env);
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
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[langwatch:workers] fatal boot failure: ${message}\n`);
  process.exit(1);
});
