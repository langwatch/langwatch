import "@langwatch/time/polyfill";
import { buildChartFrameDocument } from "@langwatch/analytics-contract/chart-frame-document";
import { CHART_FRAME_PATH } from "@langwatch/analytics-contract/chart-frame-protocol";
import { processMetrics, processTelemetry } from "@langwatch/observability/node";
import { type HealthRoute, processConfig, Server, type ProcessServer } from "@langwatch/process";
import { servingUpgradeGate } from "@langwatch/upgrade/gate";

import { processEnvironment } from "./config.ts";
import { processModules } from "./process-modules.generated.ts";

/**
 * Parity with platform/app's routes/health.ts: operational infrastructure
 * (load balancers, k8s probes) points at "/api/health", not the framework's
 * own "/healthz" door. Same shape, same status: no body, 204.
 */
export const apiHealthRoute: HealthRoute = {
  path: "/api/health",
  handle: (_request, response) => {
    response.writeHead(204).end();
  },
};

/**
 * The local launcher hosts both halves in one Node process: only the owner may
 * take signals or exit, and only one half may set the telemetry SDK up.
 */
export type ApiStartOptions = Readonly<{
  ownsProcess?: boolean;
  ownsTelemetry?: boolean;
  /** The launcher's port for this api, beside a generation still serving API_PORT. */
  port?: number;
}>;

/** Boots the API and starts serving. The server it answers with drains it. */
export async function startApi(options: ApiStartOptions = {}): Promise<ProcessServer> {
  const preamble = Server.create("langwatch-api")
    .withEnvironment(processEnvironment)
    .withConfig(processConfig(processModules))
    .withSecrets((config, secrets) =>
      secrets.withEnv().withFile().withOnePassword(config.process.onePasswordAccount),
    )
    .withProcessOwnership(options.ownsProcess ?? true)
    .withHealthPort(options.port)
    .withUpgradeGate({ role: "api", gate: servingUpgradeGate });
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
