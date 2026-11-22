import {
  type AppendStore,
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type RetentionPolicyResolver,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type {
  CanonicalMetricDataPoint,
  MetricProcessingEvent,
  RecordMetricDataPointCommandData,
} from "@langwatch/metric-contract";
import {
  METRIC_COMMAND_COALESCE_MAX_BATCH,
  METRIC_PROCESSING_PIPELINE_NAME,
  metricDataPointReceivedEventSchema,
} from "@langwatch/metric-contract";

import type { MetricModule } from "../app/metric.app.ts";
import type { MetricDataPointAppendRepository } from "../repositories/metric-data-point-append.repository.ts";
import { metricCommandGroupKey } from "../rules/metric-command-lanes.rules.ts";
import { MetricDataPointStorageMapProjection } from "./metric-data-point-storage.projection.ts";
import {
  MetricDataPointAppendStore,
  MetricSeriesCatalogAppendStore,
  MetricTimeRollupAppendStore,
} from "./metric-projection.store.ts";
import { MetricSeriesCatalogMapProjection } from "./metric-series-catalog.projection.ts";
import { MetricTimeRollupMapProjection } from "./metric-time-rollup.projection.ts";
import { RecordMetricDataPointCommand } from "./metric.commands.ts";

interface MetricProcessingPipelineDeps {
  metricDataPointAppendStore: AppendStore<CanonicalMetricDataPoint>;
  metricSeriesCatalogAppendStore: AppendStore<CanonicalMetricDataPoint>;
  metricTimeRollupAppendStore: AppendStore<CanonicalMetricDataPoint>;
  metricCommandShardCount: number;
  /** Each tenant's retention, stamped on the metric rows in place of the default (§9). */
  retention?: RetentionPolicyResolver;
}

interface MetricProcessingPipelineOptions {
  repository: MetricDataPointAppendRepository;
  defaultRetentionDays: number;
  metricCommandShardCount: number;
  /** Each tenant's retention, stamped on the metric rows in place of the default (§9). */
  retention?: RetentionPolicyResolver;
}

export type MetricProcessingPipeline = StaticPipelineDefinition<
  MetricProcessingEvent,
  Record<string, Projection>,
  { name: "recordDataPoint"; payload: RecordMetricDataPointCommandData }
>;

export function createMetricProcessingPipeline(
  deps: MetricProcessingPipelineDeps,
): MetricProcessingPipeline {
  let builder = definePipeline({
    name: "metric_processing",
    aggregate: defineAggregate({
      type: "metric",
    }),
  })
    .withEvents([metricDataPointReceivedEventSchema])
    .withClickHouseMapProjection(
      MetricDataPointStorageMapProjection.create({
        store: deps.metricDataPointAppendStore,
        shardCount: deps.metricCommandShardCount,
      }),
    )
    .withClickHouseMapProjection(
      MetricSeriesCatalogMapProjection.create({
        store: deps.metricSeriesCatalogAppendStore,
        shardCount: deps.metricCommandShardCount,
      }),
    )
    .withClickHouseMapProjection(
      MetricTimeRollupMapProjection.create({
        store: deps.metricTimeRollupAppendStore,
        shardCount: deps.metricCommandShardCount,
      }),
    );

  if (deps.retention) builder = builder.withRetention(deps.retention);

  return builder
    .withCommand("recordDataPoint", RecordMetricDataPointCommand, {
      getGroupKey: (payload) =>
        metricCommandGroupKey({
          pointId: payload.pointId,
          shardCount: deps.metricCommandShardCount,
        }),
      // ADR-066 pillar 2: a shard funnels many data points into one group, so a
      // backed-up shard appends one tiny insert per point. Coalesce its queued
      // points into one multi-row insert instead. Safe to fold: the handler
      // derives its event from its own command alone and never reads back a
      // same-batch append.
      coalesceMaxBatch: METRIC_COMMAND_COALESCE_MAX_BATCH,
    })
    .build();
}

/** The pipeline over one append repository: its three projections share that repository. */
export function buildMetricProcessingPipeline({
  repository,
  defaultRetentionDays,
  metricCommandShardCount,
  retention,
}: MetricProcessingPipelineOptions): MetricProcessingPipeline {
  return createMetricProcessingPipeline({
    metricDataPointAppendStore: MetricDataPointAppendStore.create(repository, defaultRetentionDays),
    metricSeriesCatalogAppendStore: MetricSeriesCatalogAppendStore.create(
      repository,
      defaultRetentionDays,
    ),
    metricTimeRollupAppendStore: MetricTimeRollupAppendStore.create(
      repository,
      defaultRetentionDays,
    ),
    metricCommandShardCount,
    ...(retention === undefined ? {} : { retention }),
  });
}

/**
 * The registration: the app builds the definition, and the senders are bound back to it once the
 * runtime has built them (ADR-144). A peer that reacts to a point declares its own peer
 * subscriber on this event.
 */
export const metricEventing = defineEventingModule({
  pipeline: METRIC_PROCESSING_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, MetricModule>) => app.eventingPipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
