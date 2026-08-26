// One-shot task executable boundary. Tasks intentionally do not use AppBoot:
// most tasks have no application graph at all. They still load environment
// sources explicitly before task modules that may construct one.
void (async () => {
  const { loadEnvironment } = await import("./env-load");
  loadEnvironment();

  const { initializeEnvironmentConfig } = await import("./env.mjs");
  const environment = initializeEnvironmentConfig(process.env);

  const { createLogger } = await import("@langwatch/observability");
  const { tryGetApp } = await import("./server/app-layer/app");
  const { TASKS } = await import("./tasks.generated");
  const logger = createLogger("langwatch:task");
  const args = process.argv.slice(2);

  const taskName = args[0] ?? "";
  try {
    if (!taskName) {
      throw new Error("Please specify a task to run");
    }
    const load = TASKS[taskName];
    if (!load) {
      // Inside the try so the finally below still disconnects Redis.
      throw new Error(
        `Task "${taskName}" not found. Available tasks: ${Object.keys(TASKS)
          .sort()
          .join(", ")}`,
      );
    }
    logger.info({ taskName }, "running");
    const script = await load();
    if (taskName === "cleanupOldLambdas") {
      const { resolveNlpLambdaRuntimeConfig } = await import("./runtime/api/nlp-lambda");
      const { createProcessNlpLambdaRuntime } =
        await import("./server/app-layer/nlp-lambda.runtime");
      const nlpLambda = createProcessNlpLambdaRuntime({
        config: resolveNlpLambdaRuntimeConfig(environment),
        redis: null,
      });
      await script.default(nlpLambda);
    } else {
      await script.default(...args.slice(1));
    }
  } catch (error) {
    logger.error({ error, taskName }, "failed");
    throw error;
  } finally {
    try {
      await tryGetApp()?.close();
    } catch (closeError) {
      logger.error({ error: closeError, taskName }, "failed to close the app");
    }
    logger.info("done");
  }

  process.exit(0);
})().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[langwatch:task] fatal task failure: ${message}\n`);
  process.exit(1);
});
