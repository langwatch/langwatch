// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";

import process from "node:process";

import { setTraceUrlProvider } from "@langwatch/handled-error";
import { configureLogger, createLogger, loggerConfigurationFrom } from "@langwatch/observability";
import { grafanaTraceUrlFromEnv } from "@langwatch/observability/grafana-links";
import { startOtlpMetricsExport } from "@langwatch/observability/node";
import { Server } from "@langwatch/process-server";
import { SecretEnvironmentService, secretLogRedactPaths } from "@langwatch/secrets";
import { createServerApp } from "@langwatch/installed-modules/server";

import { resolveWorkerConfig } from "./config.ts";

/**
 * The worker process, whole. The same shape the api boots with: telemetry
 * first so a config parse failure is observable, then the server that owns the
 * teardown, then the application the installed modules compose.
 */
export async function startWorker(): Promise<Server> {
  const secrets = await SecretEnvironmentService.create({ source: process.env }).resolve();
  const config = resolveWorkerConfig(secrets.environment);

  configureLogger({ ...loggerConfigurationFrom(config), redactPaths: secretLogRedactPaths() });
  setTraceUrlProvider(grafanaTraceUrlFromEnv);
  startOtlpMetricsExport(config.otlpMetrics);
  const logger = createLogger(config.serviceName);

  const server = Server.create({
    name: config.serviceName,
    logger,
    shutdownDeadlineMs: config.shutdown.processDeadlineMs,
  });

  const runtime = await createServerApp("worker").boot();

  // Jobs drain before anything they call into is released.
  server.host({
    name: "worker runtime",
    start: () => runtime.start(),
    stop: () => runtime.stop(),
    drain: true,
  });
  await server.listen();
  return server;
}

void startWorker();
