// Legacy compatibility shell. The physical local-orchestrator task executable
// owns process boot, configuration, observability, exits, and flushing.
void (async () => {
  const { loadEnvironment } = await import("./env-load");
  loadEnvironment();

  const { initializeEnvironmentConfig } = await import("./env.mjs");
  const environment = initializeEnvironmentConfig(process.env);
  const { runLocalTaskEntrypoint } = await import("@langwatch/server/task");
  const { LegacyPlatformTaskExecutor } =
    await import("./runtime/task/legacy-platform-task.executor");
  await runLocalTaskEntrypoint({
    source: process.env,
    executor: new LegacyPlatformTaskExecutor({ environment, source: process.env }),
  });
})().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[langwatch:task] fatal task failure: ${message}\n`);
  process.exit(1);
});
