import "@langwatch/time/polyfill";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { classifyEventLogRowRetention } from "@langwatch/data-retention-contract/event-log-retention-policy";
import { processMetrics, processTelemetry } from "@langwatch/observability/node";
import {
  type IdIndexRetention,
  processConfig,
  Server,
  type ProcessServer,
} from "@langwatch/process";
import { servingUpgradeGate } from "@langwatch/upgrade/gate";

import { processEnvironment } from "./config.ts";
import { processModules } from "./process-modules.generated.ts";

/**
 * The local launcher hosts both halves in one Node process: only the owner may
 * take signals or exit, and only one half may set the telemetry SDK up.
 */
export type WorkerStartOptions = Readonly<{
  ownsProcess?: boolean;
  ownsTelemetry?: boolean;
}>;

/** Each module's id-index fill raises its indexes' retention through data-retention. */
const raiseThroughDataRetention: IdIndexRetention =
  ({ api }) =>
  (input) =>
    api(DataRetentionApi).raiseIdIndexRetention(input);

function workerPreamble({ ownsProcess }: { ownsProcess: boolean }) {
  return Server.create("langwatch-worker")
    .withEnvironment(processEnvironment)
    .withConfig(processConfig(processModules, "worker"))
    .withSecrets((config, secrets) =>
      secrets.withEnv().withFile().withOnePassword(config.process.onePasswordAccount),
    )
    .withProcessOwnership(ownsProcess)
    .withIdIndexRetention(raiseThroughDataRetention)
    .withUpgradeGate({ role: "worker", gate: servingUpgradeGate });
}

/** Boots the worker and starts consuming. The server it answers with drains it. */
export async function startWorker(options: WorkerStartOptions = {}): Promise<ProcessServer> {
  const preamble = workerPreamble({ ownsProcess: options.ownsProcess ?? true });
  const server = await (
    (options.ownsTelemetry ?? true)
      ? preamble
          .withTelemetry(processTelemetry("langwatch-worker"))
          .withMetrics(processMetrics("langwatch-worker"))
      : preamble
  ).start();

  const app = await server
    .container("worker")
    .boot({ classifyEventLogRetention: classifyEventLogRowRetention });

  await server.run(app);

  return server;
}

/** `pnpm task upgrade`: the worker runs the upgrade once, in-process, and answers 0, 1 or 3. */
export function upgradeOnce(): Promise<number> {
  return workerPreamble({ ownsProcess: true }).runUpgradeOnce();
}

/** How long a finished run-once upgrade waits for its last lines before it exits regardless. */
const UPGRADE_ONCE_EXIT_GRACE_MS = 5_000;

if (import.meta.main) {
  if (process.argv[2] === "upgrade") {
    const exitCode = await upgradeOnce();
    process.exitCode = exitCode;
    setTimeout(() => process.exit(exitCode), UPGRADE_ONCE_EXIT_GRACE_MS).unref();
  } else {
    await startWorker();
  }
}
