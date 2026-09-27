import { createApiFixture } from "@langwatch/api-fixture";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { createTenantId } from "@langwatch/eventing";
import {
  type CanonicalMetricDataPoint,
  METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
  type MetricProcessingEvent,
} from "@langwatch/metric-contract";
import { describe, expect, it } from "vitest";

import { point } from "../../app/__tests__/metric.fixture.ts";
import { createCodingAgentMetricFactsDispatchSubscriber } from "../coding-agent-metric-facts-dispatch.subscriber.ts";

const POINT = point({ timeUnixMs: 1_500, metricName: "claude_code.cost.usage" });

function receivedEvent(dataPoint: CanonicalMetricDataPoint): MetricProcessingEvent {
  return {
    id: `event-${dataPoint.pointId}`,
    aggregateId: dataPoint.seriesId,
    aggregateType: "metric_series",
    tenantId: createTenantId(dataPoint.tenantId),
    createdAt: 1_500,
    occurredAt: 1_500,
    type: METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
    version: "2025-01-01",
    data: dataPoint,
  };
}

function subscriber() {
  const forwarded: CanonicalMetricDataPoint[] = [];
  const definition = createCodingAgentMetricFactsDispatchSubscriber({
    codingAgents: createApiFixture<CodingAgentApi>({
      contributeReceivedMetricPoint: async (dataPoint) => {
        forwarded.push(dataPoint);
      },
    }),
  });
  return { definition, forwarded };
}

function deduplicationIdOf(
  definition: ReturnType<typeof createCodingAgentMetricFactsDispatchSubscriber>,
  event: MetricProcessingEvent,
): string {
  const strategy = definition.options?.deduplication;
  if (strategy === undefined || strategy === "aggregate") {
    throw new Error("the dispatch declares its own deduplication id");
  }
  return strategy.makeId(event);
}

const context = { tenantId: POINT.tenantId, aggregateId: POINT.seriesId };

describe("codingAgentMetricFactsDispatch", () => {
  describe("when a received metric point is redelivered", () => {
    /** @scenario "Each received metric point is forwarded to coding-agent once per point" */
    it("forwards the same point each time under one deduplication identity", async () => {
      const { definition, forwarded } = subscriber();
      const event = receivedEvent(POINT);

      await definition.handle(event, context);
      await definition.handle(event, context);

      expect(forwarded).toEqual([POINT, POINT]);
      expect(deduplicationIdOf(definition, event)).toBe(
        deduplicationIdOf(definition, { ...event, id: "event-redelivered" }),
      );
    });

    it("keys two points of one series apart", () => {
      const { definition } = subscriber();
      const other = receivedEvent({ ...POINT, pointId: "c".repeat(64) });

      expect(deduplicationIdOf(definition, receivedEvent(POINT))).not.toBe(
        deduplicationIdOf(definition, other),
      );
    });
  });
});
