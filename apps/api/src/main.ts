// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";

import process from "node:process";

import { setTraceUrlProvider } from "@langwatch/handled-error";
import { configureLogger, createLogger } from "@langwatch/observability";
import { grafanaTraceUrlFromEnv } from "@langwatch/observability/grafana-links";
import { startOtlpMetricsExport } from "@langwatch/observability/node";
import { Server } from "@langwatch/process-server";
import { SecretEnvironmentService, secretLogRedactPaths } from "@langwatch/secrets";
import { createServerApp } from "@langwatch/installed-modules/server";

import { apiLoggerConfiguration, resolveApiConfig } from "./config.ts";

/**
 * The api process, whole. Telemetry first so a config parse failure is logged
 * and traced, then the server that owns the teardown, then the application the
 * installed modules compose, mounted on it.
 */
export async function startApi(): Promise<Server> {
  const secrets = await SecretEnvironmentService.create({ source: process.env }).resolve();
  const config = resolveApiConfig(secrets.environment);

  configureLogger({ ...apiLoggerConfiguration(config), redactPaths: secretLogRedactPaths() });
  setTraceUrlProvider(grafanaTraceUrlFromEnv);
  startOtlpMetricsExport(config.otlpMetrics);
  const logger = createLogger(config.serviceName);

  const server = Server.create({
    name: config.serviceName,
    logger,
    shutdownDeadlineMs: config.shutdown.processDeadlineMs,
  });

  const runtime = await createServerApp("api").boot();

  server.host({ name: "api runtime", start: () => runtime.start(), stop: () => runtime.stop() });
  await server.listen();
  return server;
}

void startApi();
