import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import {
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
  type CanonicalLogRecord,
} from "@langwatch/log-contract";
import {
  type CanonicalMetricDataPoint,
  METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
} from "@langwatch/metric-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  buildTestCodingAgentProcessingPipeline,
  inertReceivedFacts,
} from "../../__tests__/fixtures/coding-agent-processing.fixture.ts";

const LOG_RECORD: CanonicalLogRecord = {
  tenantId: "tenant-1",
  organizationId: "organization-1",
  recordId: "a".repeat(64),
  resourceSchemaUrl: "",
  resourceAttributesJson: "[]",
  resourceAttributesFlatJson: "{}",
  resourceAttributeKeys: [],
  resourceDroppedAttributesCount: 0,
  scopeSchemaUrl: "",
  scopeName: "com.anthropic.claude_code.events",
  scopeVersion: "",
  scopeAttributesJson: "[]",
  scopeAttributeKeys: [],
  scopeDroppedAttributesCount: 0,
  wireTraceId: "",
  wireSpanId: "",
  correlationTraceId: "",
  correlationSpanId: "",
  correlationSource: "none",
  timeUnixNano: "1",
  observedTimeUnixNano: "1",
  timeUnixMs: 1_500,
  severityNumber: 9,
  severityText: "INFO",
  bodyType: "empty",
  bodyJson: "null",
  bodyText: null,
  attributesJson: "[]",
  attributesFlatJson: JSON.stringify({ "event.name": "user_prompt", "session.id": "sess-1" }),
  attributeKeys: [],
  droppedAttributesCount: 0,
  flags: 0,
  eventName: "",
  providerKind: "claude_code",
  providerEventKind: "",
  providerEventSequence: "",
  providerSessionId: "",
  providerConversationId: "",
  providerPromptId: "",
  piiRedactionLevel: "STRICT",
  canonicalPayload: "{}",
  canonicalSizeBytes: 2,
  occurredAt: 1_500,
  acceptedAt: 1_500,
};

const METRIC_POINT: CanonicalMetricDataPoint = {
  tenantId: "tenant-1",
  organizationId: "organization-1",
  pointId: "b".repeat(64),
  seriesId: "a".repeat(64),
  resourceSchemaUrl: "",
  resourceAttributesJson: "[]",
  resourceAttributeKeys: [],
  scopeSchemaUrl: "",
  scopeName: "scope",
  scopeVersion: "",
  scopeAttributesJson: "[]",
  scopeAttributeKeys: [],
  metricName: "claude_code.cost.usage",
  metricDescription: "",
  metricUnit: "1",
  metricKind: "gauge",
  aggregationTemporality: "unspecified",
  isMonotonic: null,
  pointAttributesJson: "[]",
  pointAttributeKeys: [],
  startTimeUnixNano: "1",
  timeUnixNano: "1500000000",
  timeUnixMs: 1_500,
  flags: 0,
  valueType: "double",
  valueInt: null,
  valueDouble: null,
  count: null,
  sum: null,
  min: null,
  max: null,
  explicitBounds: [],
  bucketCounts: [],
  exponentialScale: null,
  exponentialZeroThreshold: null,
  zeroCount: null,
  positiveOffset: null,
  positiveBucketCounts: [],
  negativeOffset: null,
  negativeBucketCounts: [],
  summaryQuantilesJson: "[]",
  canonicalPayload: "{}",
  canonicalSizeBytes: 2,
  occurredAt: 1_500,
  acceptedAt: 1_500,
};

const LOG_LANE = "coding_agent_processing.codingAgentLogFactsDispatch";
const METRIC_LANE = "coding_agent_processing.codingAgentMetricFactsDispatch";

/** The peer lanes the real pipeline registers on the global registry, by lane name. */
function peerLanes(
  receivedFacts: Parameters<typeof buildTestCodingAgentProcessingPipeline>[1] = inertReceivedFacts,
): Map<string, EventSubscriberDefinition> {
  const pipeline = buildTestCodingAgentProcessingPipeline(undefined, receivedFacts);
  const lanes = new Map<string, EventSubscriberDefinition>();
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void lanes.set(subscriber.name, subscriber),
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  return lanes;
}

function lane({
  lanes,
  name,
}: {
  lanes: Map<string, EventSubscriberDefinition>;
  name: string;
}): EventSubscriberDefinition {
  const found = lanes.get(name);
  if (found === undefined) throw new Error(`no peer lane registered as ${name}`);
  return found;
}

function eventOf({
  type,
  aggregateId,
  data,
  id = `event-${aggregateId}`,
}: {
  type: string;
  aggregateId: string;
  data: unknown;
  id?: string;
}): Event {
  return {
    id,
    aggregateId,
    aggregateType: "log",
    tenantId: createTenantId("tenant-1"),
    createdAt: 1_500,
    occurredAt: 1_500,
    type,
    version: "2025-01-01",
    data,
  };
}

function deduplicationIdOf({
  definition,
  event,
}: {
  definition: EventSubscriberDefinition;
  event: Event;
}): string {
  const strategy = definition.options?.deduplication;
  if (strategy === undefined || strategy === "aggregate") {
    throw new Error("the peer subscriber declares its own deduplication id");
  }
  return strategy.makeId(event);
}

function logEvent({ record, id }: { record: CanonicalLogRecord; id?: string }): Event {
  return eventOf({
    type: CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
    aggregateId: record.recordId,
    data: record,
    ...(id === undefined ? {} : { id }),
  });
}

function metricEvent({ point, id }: { point: CanonicalMetricDataPoint; id?: string }): Event {
  return eventOf({
    type: METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
    aggregateId: point.seriesId,
    data: point,
    ...(id === undefined ? {} : { id }),
  });
}

describe("coding-agent's peer subscribers on log and metric", () => {
  describe("when the pipeline is composed", () => {
    /** @scenario "The ADR-056 edge is mounted rather than declared missing" */
    it("mounts a peer lane on log's record event and one on metric's point event", () => {
      const lanes = peerLanes();

      expect(lane({ lanes, name: LOG_LANE }).eventTypes).toEqual([
        CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
      ]);
      expect(lane({ lanes, name: METRIC_LANE }).eventTypes).toEqual([
        METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
      ]);
    });
  });

  describe("when a received log record is redelivered", () => {
    /** @scenario "Each received log record is forwarded to coding-agent once per record" */
    it("contributes the same record each time under one deduplication identity", async () => {
      const contributed: CanonicalLogRecord[] = [];
      const definition = lane({
        lanes: peerLanes({
          ...inertReceivedFacts,
          contributeReceivedLogRecord: async (record) => void contributed.push(record),
        }),
        name: LOG_LANE,
      });
      const event = logEvent({ record: LOG_RECORD });
      const context = { tenantId: LOG_RECORD.tenantId, aggregateId: LOG_RECORD.recordId };

      await definition.handle(event, context);
      await definition.handle(event, context);

      expect(contributed).toEqual([LOG_RECORD, LOG_RECORD]);
      expect(deduplicationIdOf({ definition, event })).toBe(
        deduplicationIdOf({
          definition,
          event: logEvent({ record: LOG_RECORD, id: "redelivered" }),
        }),
      );
    });

    it("keys two records apart", () => {
      const definition = lane({ lanes: peerLanes(), name: LOG_LANE });
      const other = logEvent({ record: { ...LOG_RECORD, recordId: "c".repeat(64) } });

      expect(deduplicationIdOf({ definition, event: logEvent({ record: LOG_RECORD }) })).not.toBe(
        deduplicationIdOf({ definition, event: other }),
      );
    });
  });

  describe("when a received metric point is redelivered", () => {
    /** @scenario "Each received metric point is forwarded to coding-agent once per point" */
    it("contributes the same point each time under one deduplication identity", async () => {
      const contributed: CanonicalMetricDataPoint[] = [];
      const definition = lane({
        lanes: peerLanes({
          ...inertReceivedFacts,
          contributeReceivedMetricPoint: async (point) => void contributed.push(point),
        }),
        name: METRIC_LANE,
      });
      const event = metricEvent({ point: METRIC_POINT });
      const context = { tenantId: METRIC_POINT.tenantId, aggregateId: METRIC_POINT.seriesId };

      await definition.handle(event, context);
      await definition.handle(event, context);

      expect(contributed).toEqual([METRIC_POINT, METRIC_POINT]);
      expect(deduplicationIdOf({ definition, event })).toBe(
        deduplicationIdOf({
          definition,
          event: metricEvent({ point: METRIC_POINT, id: "redelivered" }),
        }),
      );
    });

    it("keys two points of one series apart", () => {
      const definition = lane({ lanes: peerLanes(), name: METRIC_LANE });
      const other = metricEvent({ point: { ...METRIC_POINT, pointId: "c".repeat(64) } });

      expect(
        deduplicationIdOf({ definition, event: metricEvent({ point: METRIC_POINT }) }),
      ).not.toBe(deduplicationIdOf({ definition, event: other }));
    });
  });
});
