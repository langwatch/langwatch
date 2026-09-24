import "@langwatch/time/polyfill";
import { buildChartFrameDocument } from "@langwatch/analytics-contract/chart-frame-document";
import { CHART_FRAME_PATH } from "@langwatch/analytics-contract/chart-frame-protocol";
import { langWatchQlSupply } from "@langwatch/analytics-process";
import { createDataPrivacyDirectoryReader } from "@langwatch/data-privacy-process";
import { serverModules as processModules } from "@langwatch/installed-server-modules";
import { processMetrics, processTelemetry } from "@langwatch/observability/node";
import { processConfig, Server, type ProcessServer } from "@langwatch/process-server";

import { apiHealthRoute } from "./api-health-route.ts";

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

  const app = await server
    .composeProcess("api")
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
    .exposeTransports((transports) =>
      transports
        .trpc()
        .rest()
        .browserBundle()
        .framedDocument({ path: CHART_FRAME_PATH, document: buildChartFrameDocument }),
    )
    .withPipelines((pipelines) => pipelines.produce())
    .boot();

  await server.serve(app);

  return server;
}

if (import.meta.main) await startApi();
