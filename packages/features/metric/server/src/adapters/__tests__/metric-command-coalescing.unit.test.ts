import type { EventStoreReadContext } from "@langwatch/eventing";
import { processCommandBatch } from "@langwatch/eventing/testing";
import type { ProcessCommandBatchParams } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";
import { RecordMetricDataPointCommand } from "../metric-processing.adapter";
import { createMetricProcessingPipeline } from "../metric-processing.adapter";
import {
  METRIC_COMMAND_COALESCE_MAX_BATCH,
  METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
  RECORD_METRIC_DATA_POINT_COMMAND_TYPE,
} from "@langwatch/metric-contract";
import type {
  CanonicalMetricDataPoint,
  MetricDataPointReceivedEvent,
} from "@langwatch/metric-contract";
import { point } from "@langwatch/metric-server/testing";

const TENANT_ID = "project_metric_coalescing";

function dataPoint({ index }: { index: number }): CanonicalMetricDataPoint {
  return point({
    tenantId: TENANT_ID,
    timeUnixMs: 1_800_000_000_000 + index,
    pointId: index.toString(16).padStart(64, "0"),
    valueDouble: index,
  });
}

function batchParamsFor({
  payloads,
  storeEventsFn,
}: {
  payloads: CanonicalMetricDataPoint[];
  storeEventsFn: (
    events: MetricDataPointReceivedEvent[],
    context: EventStoreReadContext<MetricDataPointReceivedEvent>,
  ) => Promise<void>;
}): ProcessCommandBatchParams<MetricDataPointReceivedEvent> {
  return {
    payloads: payloads.map((payload) => ({ ...payload })),
    commandType: RECORD_METRIC_DATA_POINT_COMMAND_TYPE,
    commandSchema: RecordMetricDataPointCommand.schema,
    handler: new RecordMetricDataPointCommand(),
    getAggregateId: RecordMetricDataPointCommand.getAggregateId,
    storeEventsFn,
    aggregateType: "metric" as const,
    commandName: "recordDataPoint",
    pipelineName: "metric_processing",
  };
}

function buildPipeline() {
  const store = { append: async () => undefined };
  return createMetricProcessingPipeline({
    metricDataPointAppendStore: store,
    metricSeriesCatalogAppendStore: store,
    metricTimeRollupAppendStore: store,
    metricCommandShardCount: 8,
  });
}

describe("metric command append coalescing", () => {
  describe("given the metric-processing pipeline is defined", () => {
    describe("when recordDataPoint is registered", () => {
      /** @scenario 'many items for one aggregate become one insert' */
      it("carries an append-coalescing bound alongside its shard routing", () => {
        const command = buildPipeline().commands.find(
          (candidate) => candidate.name === "recordDataPoint",
        );

        expect(command?.options?.coalesceMaxBatch).toBe(METRIC_COMMAND_COALESCE_MAX_BATCH);
        expect(command?.options?.getGroupKey).toBeDefined();
      });
    });
  });

  describe("given several queued data points from one shard", () => {
    describe("when the coalesced batch is processed", () => {
      /** @scenario 'many items for one aggregate become one insert' */
      /** @scenario 'coalescing preserves every item' */
      it("appends them as one insert holding every point in dispatch order", async () => {
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [0, 1, 2, 3].map((index) => dataPoint({ index }));

        await processCommandBatch(batchParamsFor({ payloads, storeEventsFn }));

        expect(storeEventsFn).toHaveBeenCalledTimes(1);
        const [events, context] = storeEventsFn.mock.calls[0]!;
        expect(events.map((event: MetricDataPointReceivedEvent) => event.aggregateId)).toEqual(
          payloads.map((payload) => payload.pointId),
        );
        expect(
          events.every(
            (event: MetricDataPointReceivedEvent) =>
              event.type === METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
          ),
        ).toBe(true);
        expect(context).toEqual({ tenantId: TENANT_ID });
      });

      /** @scenario 'coalescing preserves every item' */
      it("keeps each point's idempotency key so a retry cannot duplicate it", async () => {
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [0, 1].map((index) => dataPoint({ index }));

        await processCommandBatch(batchParamsFor({ payloads, storeEventsFn }));

        const [events] = storeEventsFn.mock.calls[0]!;
        expect(events.map((event: MetricDataPointReceivedEvent) => event.idempotencyKey)).toEqual(
          payloads.map((payload) => `${TENANT_ID}:${payload.pointId}`),
        );
      });
    });
  });
});
