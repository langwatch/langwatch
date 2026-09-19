import "@langwatch/time/polyfill";
import { auditLogNullServer } from "@langwatch/audit-log-null";
import { createDataPrivacyDirectoryReader } from "@langwatch/data-privacy-process";
import { serverModules as processModules } from "@langwatch/installed-server-modules";
import { processMetrics, processTelemetry } from "@langwatch/observability/node";
import { processConfig, Server, type ProcessServer } from "@langwatch/process-server";

import { apiHealthRoute } from "./api-health-route.ts";
import { discoveryOpenapiRoute } from "./discovery-openapi-route.ts";

/**
 * The local launcher hosts both halves in one Node process: only the owner may
 * take signals or exit, and only one half may set the telemetry SDK up.
 */
export type ApiStartOptions = Readonly<{
  ownsProcess?: boolean;
  ownsTelemetry?: boolean;
}>;

/** Boots the API and starts serving. The server it answers with drains it. */
export async function startApi(options: ApiStartOptions = {}): Promise<ProcessServer> {
  const preamble = Server.create("langwatch-api")
    .withConfig(processConfig(processModules))
    .withSecrets((config, secrets) =>
      secrets.withEnv().withFile().withOnePassword(config.process.onePasswordAccount),
    )
    .withProcessOwnership(options.ownsProcess ?? true);
  const server = await (
    (options.ownsTelemetry ?? true)
      ? preamble
          .withTelemetry(processTelemetry("langwatch-api"))
          .withMetrics(processMetrics("langwatch-api"))
      : preamble
  ).start();
  server.with(apiHealthRoute);
  server.with(discoveryOpenapiRoute);

  const app = await server
    .composeProcess("api")
    .withModules(processModules)
    // Availability, not a module install: audit-log's implementation is
    // enterprise, so core answers the subject with the null provider.
    .withModules([auditLogNullServer])
    .withMember("dataPrivacy", (members) => ({
      directory: createDataPrivacyDirectoryReader(members.read("prisma")),
      redaction: null,
    }))
    .withMember("elevenLabsWebhook", () => void 0)
    // Dataset's four optional seams. This process composes none, so each is
    // answered "none" and the module's own absent-behaviour applies: normalize
    // runs in-process and uploads resolve through the storage resolver it builds.
    .withMember("storageResolver", () => void 0)
    .withMember("storage", () => void 0)
    .withMember("queue", () => void 0)
    .withMember("content", () => void 0)
    .withMember("gatewayInternalProtocol", () => ({}))
    .withMember("monitor", () => void 0)
    // The api composes no clustering worker, so the claim is answered by
    // something that refuses loudly rather than by `undefined`.
    .withMember("topicClustering", () => ({
      requestClustering: () =>
        Promise.reject(new Error("langwatch-api composes no topic clustering worker")),
    }))
    .exposeTransports((transports) => transports.trpc().rest().browserBundle())
    .withPipelines((pipelines) => pipelines.produce())
    .boot();

  await server.serve(app);

  return server;
}

if (import.meta.main) await startApi();
