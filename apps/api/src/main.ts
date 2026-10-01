import "@langwatch/time/polyfill";
import { buildChartFrameDocument } from "@langwatch/analytics-contract/chart-frame-document";
import { CHART_FRAME_PATH } from "@langwatch/analytics-contract/chart-frame-protocol";
import { processModules } from "@langwatch/installed-server-modules";
import { processMetrics, processTelemetry } from "@langwatch/observability/node";
import { processConfig, Server, type ProcessServer } from "@langwatch/process";

import { apiHealthRoute } from "./api-health-route.ts";
import { processEnvironment } from "./config.ts";

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
    .withEnvironment(processEnvironment)
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
    .container("api")
    .exposeTransports((transports) =>
      transports
        .trpc()
        .rest()
        .browserBundle()
        .framedDocument({ path: CHART_FRAME_PATH, document: buildChartFrameDocument }),
    )
    .boot();

  await server.serve(app);

  return server;
}

if (import.meta.main) await startApi();
