import type { MetricDataPointRepository } from "~/server/app-layer/metrics/repositories/metric-data-point.repository";
import { definePipeline } from "../..";
import type { CommandBus } from "../../commands/commandBus";
import { ContributeMetricFactsCommand } from "../coding-agent-processing/commands/contributeMetricFactsCommand";
import { createCodingAgentMetricFactsDispatchSubscriber } from "../coding-agent-processing/subscribers/codingAgentMetricFactsDispatch.subscriber";
import { metricCommandGroupKey } from "./canonical/shards";
import { RecordMetricDataPointCommand } from "./commands/recordMetricDataPointCommand";
import { MetricDataPointStorageMapProjection } from "./projections/metricDataPointStorage.mapProjection";
import { MetricSeriesCatalogMapProjection } from "./projections/metricSeriesCatalog.mapProjection";
import { MetricTimeRollupMapProjection } from "./projections/metricTimeRollup.mapProjection";
import {
  MetricDataPointAppendStore,
  MetricSeriesCatalogAppendStore,
  MetricTimeRollupAppendStore,
} from "./projections/stores";
import type { MetricProcessingEvent } from "./schemas/events";

/**
 * ADR-102 — nothing here is a value the builder registers. The three
 * append stores are constructed from the one repository they all wrap, and the
 * coding-agent dispatch subscriber is constructed from its imported factory
 * over a command-bus port, so this file states the whole topology.
 */
export interface MetricProcessingPipelineDeps {
  metricDataPointRepository: MetricDataPointRepository;
  metricCommandShardCount: number;
  /** ADR-102 — identity-keyed dispatch into other pipelines' commands. */
  commands: CommandBus;
}

export function createMetricProcessingPipeline(
  deps: MetricProcessingPipelineDeps,
) {
  const shardCount = deps.metricCommandShardCount;
  const repository = deps.metricDataPointRepository;

  return definePipeline<MetricProcessingEvent>()
    .withName("metric_processing")
    .withAggregateType("metric")
    .withMapProjection(
      "metricDataPointStorage",
      new MetricDataPointStorageMapProjection({
        store: new MetricDataPointAppendStore(repository),
        shardCount,
      }),
    )
    .withMapProjection(
      "metricSeriesCatalog",
      new MetricSeriesCatalogMapProjection({
        store: new MetricSeriesCatalogAppendStore(repository),
        shardCount,
      }),
    )
    .withMapProjection(
      "metricTimeRollup",
      new MetricTimeRollupMapProjection({
        store: new MetricTimeRollupAppendStore(repository),
        shardCount,
      }),
    )
    // Cross-pipeline dispatch (ADR-105): coding-agent metric facts. The
    // port binds now and resolves on first dispatch, so coding-agent
    // registration order relative to this pipeline carries no meaning.
    .withEventSubscriber(
      "codingAgentMetricFactsDispatch",
      createCodingAgentMetricFactsDispatchSubscriber({
        contributeMetricFacts: deps.commands.port(ContributeMetricFactsCommand),
      }),
    )
    .withCommand("recordDataPoint", RecordMetricDataPointCommand, {
      getGroupKey: (payload) =>
        metricCommandGroupKey({
          pointId: payload.pointId,
          shardCount,
        }),
    })
    .build();
}
