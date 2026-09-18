import "@langwatch/time/polyfill";
import { auditLogNullServer } from "@langwatch/audit-log-null";
import { createDataPrivacyDirectoryReader } from "@langwatch/data-privacy-process";
import { serverModules as processModules } from "@langwatch/installed-modules/server";
import { processMetrics, processTelemetry } from "@langwatch/observability/node";
import { processConfig, Server, type ProcessServer } from "@langwatch/process-server";

/**
 * The local launcher hosts both halves in one Node process: only the owner may
 * take signals or exit, and only one half may set the telemetry SDK up.
 */
export type WorkerStartOptions = Readonly<{
  ownsProcess?: boolean;
  ownsTelemetry?: boolean;
}>;

/** Boots the worker and starts consuming. The server it answers with drains it. */
export async function startWorker(options: WorkerStartOptions = {}): Promise<ProcessServer> {
  const preamble = Server.create("langwatch-worker")
    .withConfig(processConfig(processModules, "worker"))
    .withSecrets((config, secrets) =>
      secrets.withEnv().withFile().withOnePassword(config.process.onePasswordAccount),
    )
    .withProcessOwnership(options.ownsProcess ?? true);
  const server = await (
    (options.ownsTelemetry ?? true)
      ? preamble
          .withTelemetry(processTelemetry("langwatch-worker"))
          .withMetrics(processMetrics("langwatch-worker"))
      : preamble
  ).start();

  const app = await server
    .composeProcess("worker")
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
    // The worker hosts no topic-clustering caller of its own, so the claim is
    // answered by something that refuses loudly rather than by `undefined`.
    .withMember("topicClustering", () => ({
      requestClustering: () =>
        Promise.reject(new Error("langwatch-worker composes no topic clustering worker")),
    }))
    .withPipelines((pipelines) => pipelines.consume())
    .boot();

  await server.run(app);

  return server;
}

if (import.meta.main) await startWorker();
