import type {
  DataRetentionApi,
  DataRetentionServerConfig,
} from "@langwatch/data-retention-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { DataRetentionModule } from "./app/data-retention.app.ts";
import { dataRetentionSeatPolicyEventing } from "./eventing/data-retention-seat-policy.pipeline.ts";
import { dataRetentionRepositories } from "./repositories/data-retention-repositories.registry.ts";
import { EventLogKeepForeverService } from "./services/event-log-keep-forever.service.ts";
import { dataRetentionTrpcTransport } from "./transport/data-retention.trpc.ts";

export const dataRetentionProcessModule: PublishedProcessModule<
  "data-retention",
  DataRetentionApi,
  DataRetentionServerConfig
> = defineProcessModule("data-retention")
  .withRepositories(dataRetentionRepositories)
  .withApi(DataRetentionModule)
  .withTransports(dataRetentionTrpcTransport)
  .withEventing(dataRetentionSeatPolicyEventing)
  .withMigrations(({ repositories }) => [
    defineMigrationStep({
      id: "data-retention:keep-control-plane-events-forever",
      kind: "data",
      mode: "background",
      description:
        "Keeps every event that is not customer telemetry forever, including those already stamped to expire.",
      needsOldWritersGone: true,
      run: ({ checkpoint, dryRun, signal }) => {
        const resumed = checkpoint.resumeFrom?.done;
        return EventLogKeepForeverService.create({
          retroactive: repositories.retroactive,
        }).keepIndefiniteEventsForever({
          dryRun,
          signal,
          done: Array.isArray(resumed) ? resumed.filter((name) => typeof name === "string") : [],
          onTargetDone: (progress) => checkpoint.save({ report: progress }),
        });
      },
    }),
  ]);
