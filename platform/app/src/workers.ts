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

  const { setEnvironment } = await import("@langwatch/ksuid");
  const { createLogger } = await import("@langwatch/observability");

  setEnvironment(bootstrap.environment);

  // OTel instrumentation MUST load before any module that creates spans.
  const { initializeInstrumentation } = await import("./instrumentation.node");
  initializeInstrumentation(bootstrap.telemetry);
  await import("./server/handled-error-wiring");

  const logger = createLogger("langwatch:workers");

  try {
    const { WorkerExecutable } = await import("@langwatch/worker");
    const { LegacyWorkerExecutableComposition } =
      await import("./runtime/worker/legacy-worker.executable.adapter");
    const { telemetryFlushes } = await import("./server/shutdown/telemetry");
    const worker = await WorkerExecutable.boot({
      source: process.env,
      composition: LegacyWorkerExecutableComposition.create({ source: process.env }),
      observability: {
        // Platform instrumentation remains the live telemetry provider until
        // the complete Eventing registry moves. It flushes through the
        // physical Worker's process-owned observability shutdown boundary.
        setup: { langwatch: "disabled" },
        flushers: telemetryFlushes().map((flush) => ({
          name: flush.name,
          shutdown: flush.run,
        })),
      },
    });
    await worker.start();
  } catch (error) {
    logger.error({ error }, "failed to start background workers");
    throw error;
  }
})().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[langwatch:workers] fatal boot failure: ${message}\n`);
  process.exit(1);
});
