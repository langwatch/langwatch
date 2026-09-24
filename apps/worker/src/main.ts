import "@langwatch/time/polyfill";
import { langWatchQlSupply } from "@langwatch/analytics-process";
import { createDataPrivacyDirectoryReader } from "@langwatch/data-privacy-process";
import { serverModules as processModules } from "@langwatch/installed-server-modules";
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
    .withMember("dataPrivacy", (members) => ({
      directory: createDataPrivacyDirectoryReader(members.read("prisma")),
      redaction: null,
    }))
    .withMember("langwatchQl", (members) =>
      langWatchQlSupply({
        admin: members.read("clickhouseAdmin"),
        postgres: members.read("databaseTarget"),
        database: () => members.read("prisma"),
      }),
    )
    .withMember("elevenLabsWebhook", () => void 0)
    // Dataset's two optional seams. This process composes neither, so the
    // module's own absent-behaviour applies: normalize runs in-process.
    .withMember("queue", () => void 0)
    .withMember("content", () => void 0)
    .withMember("gatewayInternalProtocol", () => ({}))
    .withMember("connectJudge", () => null)
    .withMember("monitor", () => void 0)
    .withPipelines((pipelines) => pipelines.consume())
    .boot();

  await server.run(app);

  return server;
}

if (import.meta.main) await startWorker();
