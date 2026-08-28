// One-shot task executable boundary. Tasks intentionally do not use AppBoot:
// most tasks have no application graph at all. They still load environment
// sources explicitly before task modules that may construct one.
void (async () => {
  const { loadEnvironment } = await import("./env-load");
  loadEnvironment();

  const { initializeEnvironmentConfig } = await import("./env.mjs");
  const environment = initializeEnvironmentConfig(process.env);

  const { resolveProcessBootstrapConfig } = await import("./runtime/executable-bootstrap.config");
  const bootstrap = resolveProcessBootstrapConfig(process.env);
  const { configureLogger } = await import("@langwatch/observability");
  configureLogger(bootstrap.logger);

  const { createLogger } = await import("@langwatch/observability");
  const { createProcessPrismaConnection } =
    await import("./runtime/app/prisma-process.composition");
  const { closePrismaConnection, configurePrismaConnection } = await import("./server/db");
  const { runStandaloneTaskWithPrisma } = await import("./runtime/task-prisma.lifecycle");
  const { runStandaloneNlpLambdaTask } = await import("./runtime/task-nlp-lambda.lifecycle");
  const logger = createLogger("langwatch:task");
  const args = process.argv.slice(2);

  const taskName = args[0] ?? "";
  const appComposingTasks = new Set([
    "backfillAnnotationsToClickhouse",
    "backfillStalledSimulationRuns",
    "runTopicClustering",
  ]);
  try {
    await runStandaloneTaskWithPrisma({
      compose: () =>
        createProcessPrismaConnection({
          databaseUrl: environment.DATABASE_URL,
          nodeEnv: environment.NODE_ENV,
        }),
      configure: configurePrismaConnection,
      execute: async (connection) => {
        const { TASKS } = await import("./tasks.generated");
        if (!taskName) {
          throw new Error("Please specify a task to run");
        }
        const load = TASKS[taskName];
        if (!load) {
          throw new Error(
            `Task "${taskName}" not found. Available tasks: ${Object.keys(TASKS).sort().join(", ")}`,
          );
        }
        logger.info({ taskName }, "running");
        const script = await load();
        if (appComposingTasks.has(taskName)) {
          const { initializeDefaultApp } = await import("./server/app-layer/presets");
          initializeDefaultApp({ prismaConnection: connection });
        }
        if (taskName === "cleanupOldLambdas") {
          const { default: cleanupOldLambdas } = await import("./tasks/cleanupOldLambdas");
          const { resolveNlpLambdaRuntimeConfig } = await import("./runtime/api/nlp-lambda");
          const { AppAwsClientConfiguration } =
            await import("./runtime/app/aws-client.composition");
          const { createProcessNlpLambdaRuntime } =
            await import("./server/app-layer/nlp-lambda.runtime");
          const { parseOutboundProxyConfig } = await import("./server/outboundProxy");
          const aws = AppAwsClientConfiguration.create(parseOutboundProxyConfig(process.env));
          const nlpLambda = createProcessNlpLambdaRuntime({
            config: resolveNlpLambdaRuntimeConfig(environment),
            redis: null,
            aws,
          });
          await runStandaloneNlpLambdaTask({
            execute: async () => await cleanupOldLambdas(nlpLambda),
            closeNlpLambda: () => nlpLambda.close(),
            closeAws: () => aws.close(),
            reportCloseError: ({ target, error }) => {
              logger.error({ error, taskName }, `failed to close the ${target}`);
            },
          });
        } else {
          await script.default(...args.slice(1));
        }
      },
      closeApp: async () => {
        const { tryGetApp } = await import("./server/app-layer/app");
        await tryGetApp()?.close();
      },
      closePrisma: closePrismaConnection,
      reportCloseError: ({ target, error }) => {
        logger.error({ error, taskName }, `failed to close the ${target}`);
      },
    });
  } catch (error) {
    logger.error({ error, taskName }, "failed");
    throw error;
  } finally {
    logger.info("done");
  }

  process.exit(0);
})().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[langwatch:task] fatal task failure: ${message}\n`);
  process.exit(1);
});
