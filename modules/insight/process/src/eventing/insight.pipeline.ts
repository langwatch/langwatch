/**
 * insight_processing: one aggregate per insight, two Postgres projections (the insight with
 * its owner, and the owner's own state on it) and five commands. The api and a daily run
 * send; the worker folds.
 * @see modules/insight/adrs/001-insight-aggregate.md
 * @see modules/insight/adrs/003-personal-insights.md
 */

import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StateProjectionStore,
} from "@langwatch/eventing";
import { INSIGHT_AGGREGATE_TYPE, INSIGHT_PIPELINE_NAME } from "@langwatch/insight-contract";

import type { InsightModule } from "../app/insight.app.ts";
import type { InsightRepositories } from "../repositories/insight.repositories.ts";
import {
  createInsightReaderProjection,
  type InsightReaderState,
} from "./insight-reader.projection.ts";
import {
  ArchiveInsightCommand,
  FileInsightCommand,
  KeepInsightCommand,
  MarkInsightSeenCommand,
  RenewInsightCommand,
} from "./insight.commands.ts";
import { INSIGHT_EVENT_SCHEMAS } from "./insight.events.ts";
import { createInsightProjection, type InsightState } from "./insight.projection.ts";

interface InsightPipelineDeps {
  insightStore: StateProjectionStore<InsightState>;
  readerStore: StateProjectionStore<InsightReaderState>;
}

const defineInsightPipeline = (deps: InsightPipelineDeps) =>
  definePipeline({
    name: INSIGHT_PIPELINE_NAME,
    aggregate: defineAggregate({ type: INSIGHT_AGGREGATE_TYPE }),
  })
    .withEvents(INSIGHT_EVENT_SCHEMAS)
    .withPostgresProjection(createInsightProjection({ store: deps.insightStore }))
    .withPostgresProjection(createInsightReaderProjection({ store: deps.readerStore }))
    .withCommand("fileInsight", FileInsightCommand)
    .withCommand("renewInsight", RenewInsightCommand)
    .withCommand("markInsightSeen", MarkInsightSeenCommand)
    .withCommand("archiveInsight", ArchiveInsightCommand)
    .withCommand("keepInsight", KeepInsightCommand)
    .build();

export type InsightPipelineDefinition = ReturnType<typeof defineInsightPipeline>;

/** The definition `insight_processing` registers, built once per module. */
export function buildInsightPipeline(deps: InsightPipelineDeps): InsightPipelineDefinition {
  return defineInsightPipeline(deps);
}

export const insightEventing = defineEventingModule({
  pipeline: INSIGHT_PIPELINE_NAME,
  build: ({ app }: EventingSetup<InsightRepositories, InsightModule>) => app.eventingPipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
