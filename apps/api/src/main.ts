// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";
import process from "node:process";

import { auditLogNullServer } from "@langwatch/audit-log-null";
import { createDataPrivacyDirectoryReader } from "@langwatch/data-privacy-process";
import { createActivatedLicenseSource } from "@langwatch/enterprise-licensing-process";
import { setTraceUrlProvider } from "@langwatch/handled-error";
import { createServerApp } from "@langwatch/installed-modules/server";
import { configureLogger, createLogger } from "@langwatch/observability";
import { grafanaTraceUrlFromEnv } from "@langwatch/observability/grafana-links";
import { prometheusMetrics, startOtlpMetricsExport } from "@langwatch/observability/node";
import { hostedRuntime, Server } from "@langwatch/process-server";
import { createProcessMembers, hostedMembers } from "@langwatch/process-stores";
import { SecretEnvironmentService, secretLogRedactPaths } from "@langwatch/secrets";

import {
  apiLoggerConfiguration,
  apiModuleConfig,
  apiProcessConfig,
  resolveApiConfig,
} from "./config.ts";

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
    healthPort: config.port,
  }).with(prometheusMetrics({ token: config.metricsApiKey }));

  const members = createProcessMembers({
    config: apiProcessConfig({ config, secrets: secrets.environment }),
  });
  server.with(hostedMembers(members));

  const runtime = await createServerApp("api")
    // The audit sink is this deployment's choice: OSS records nothing, enterprise swaps in its own.
    .withModules([auditLogNullServer] as const)
    .withConfig(apiModuleConfig(config))
    .withStores(members)
    .withMember("dataPrivacy", {
      directory: createDataPrivacyDirectoryReader(members.read("prisma")),
      redaction: null,
    })
    .withMember("elevenLabsWebhook", void 0)
    .withMember("gatewayInternalProtocol", {})
    .withMember("monitor", void 0)
    .withMember("topicClustering", {
      requestClustering: () =>
        Promise.reject(new Error(`${config.serviceName} composes no topic clustering worker`)),
    })
    .provide({
      licenseSource: createActivatedLicenseSource({
        prisma: members.read("prisma"),
        licensePublicKey: config.infrastructure.licensing.publicKey,
        isSaas: config.infrastructure.modelProvider.isSaas,
      }),
    })
    .boot();

  server.with(hostedRuntime({ name: "api runtime", runtime }));
  await server.listen();
  return server;
}

void startApi();
