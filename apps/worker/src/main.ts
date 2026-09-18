// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";
import process from "node:process";

import { auditLogNullServer } from "@langwatch/audit-log-null";
import { createDataPrivacyDirectoryReader } from "@langwatch/data-privacy-process";
import {
  createDeploymentEntitlementSource,
  createOrganizationLicenses,
} from "@langwatch/enterprise-licensing-process";
import { setTraceUrlProvider } from "@langwatch/handled-error";
import { createServerApp } from "@langwatch/installed-modules/server";
import { configureLogger, createLogger, loggerConfigurationFrom } from "@langwatch/observability";
import { grafanaTraceUrlFromEnv } from "@langwatch/observability/grafana-links";
import { prometheusMetrics, startOtlpMetricsExport } from "@langwatch/observability/node";
import { Server } from "@langwatch/process-server";
import { createProcessMembers, hostedMembers } from "@langwatch/process-stores";
import { SecretEnvironmentService, secretLogRedactPaths } from "@langwatch/secrets";

import { resolveWorkerConfig, workerModuleConfig, workerProcessConfig } from "./config.ts";

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
    healthPort: config.liveness.metricsPort,
  }).with(prometheusMetrics({ token: config.liveness.metricsToken }));

  const members = createProcessMembers({
    config: workerProcessConfig({ config, secrets: secrets.environment }),
  });
  server.with(hostedMembers(members));

  const runtime = await createServerApp("worker")
    // The audit sink is this deployment's choice: OSS records nothing, enterprise swaps in its own.
    .withModules([auditLogNullServer] as const)
    .withConfig(workerModuleConfig(config))
    .withStores(members)
    .withMember("dataPrivacy", {
      directory: createDataPrivacyDirectoryReader(members.read("prisma")),
      redaction: null,
    })
    .withMember("elevenLabsWebhook", void 0)
    .withMember("gatewayInternalProtocol", {})
    .withMember("monitor", void 0)
    .provide({
      licenseSource: createDeploymentEntitlementSource({
        licenses: createOrganizationLicenses(members.read("prisma")),
        licensePublicKey: config.deployment.licensePublicKey,
        isSaas: config.deployment.saas,
      }),
    })
    .boot();

  // Jobs drain before anything they call into is released.
  await server.run(runtime);
  return server;
}

void startWorker();
