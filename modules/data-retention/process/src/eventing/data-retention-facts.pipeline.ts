/**
 * data_retention_facts: data-retention records what it did to a project's data; peers follow it
 * from their own side (§9), so data-retention holds no peer of theirs.
 * Spec: modules/data-retention/specs/data-retention-service.feature
 */
import {
  DATA_RETENTION_FACTS_PIPELINE_NAME,
  DATA_RETENTION_PROJECT_AGGREGATE_TYPE,
} from "@langwatch/data-retention-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { DataRetentionModule } from "../app/data-retention.app.ts";
import type { DataRetentionRepositories } from "../repositories/data-retention.repositories.ts";
import {
  RecordRetentionAppliedToExistingDataCommand,
  retentionAppliedToExistingDataEventSchema,
} from "./data-retention-facts.commands.ts";

function buildDataRetentionFactsPipeline() {
  return definePipeline({
    name: DATA_RETENTION_FACTS_PIPELINE_NAME,
    aggregate: defineAggregate({ type: DATA_RETENTION_PROJECT_AGGREGATE_TYPE }),
  })
    .withEvents([retentionAppliedToExistingDataEventSchema])
    .withCommand(
      "recordRetentionAppliedToExistingData",
      RecordRetentionAppliedToExistingDataCommand,
    )
    .build();
}

export const dataRetentionFactsEventing = defineEventingModule({
  pipeline: DATA_RETENTION_FACTS_PIPELINE_NAME,
  build: (_setup: EventingSetup<DataRetentionRepositories, DataRetentionModule>) =>
    buildDataRetentionFactsPipeline(),
  connect: ({ app, commands }) => app.connectFacts(commands),
});
