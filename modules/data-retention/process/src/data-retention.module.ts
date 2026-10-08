import { defineProcessModule } from "@langwatch/process";
import { defineProjectionReplayStep } from "@langwatch/upgrade/step";

import { DataRetentionModule } from "./app/data-retention.app.ts";
import {
  DATA_RETENTION_PROJECT_SCOPE_PIPELINE_NAME,
  dataRetentionProjectScopeEventing,
} from "./eventing/data-retention-project-scope.pipeline.ts";
import { DATA_RETENTION_PROJECT_SCOPE_PROJECTION_NAME } from "./eventing/data-retention-project-scope.projection.ts";
import { dataRetentionSeatPolicyEventing } from "./eventing/data-retention-seat-policy.pipeline.ts";
import { dataRetentionRepositories } from "./repositories/data-retention-repositories.registry.ts";
import { dataRetentionTrpcTransport } from "./transport/data-retention.trpc.ts";

export const dataRetentionProcessModule = defineProcessModule("data-retention")
  .withRepositories(dataRetentionRepositories)
  .withApi(DataRetentionModule)
  .withTransports(dataRetentionTrpcTransport)
  .withEventing(dataRetentionProjectScopeEventing)
  .withEventing(dataRetentionSeatPolicyEventing)
  .withMigrations(({ replayer }) => [
    defineProjectionReplayStep({
      id: "data-retention:replay-project-scope",
      description:
        "Fills data retention's project scope fold from project's lifecycle log at deploy.",
      lane: `${DATA_RETENTION_PROJECT_SCOPE_PIPELINE_NAME}.${DATA_RETENTION_PROJECT_SCOPE_PROJECTION_NAME}`,
      replayer,
    }),
  ]);
