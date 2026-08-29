/**
 * The metric→session dispatcher, driven with canonical datapoints — the
 * shape metric-processing actually stores. Temporality decides the converged
 * unit: cumulative → the series (replace), delta → the point (sum once).
 *
 * @see specs/coding-agent/session-aggregate.feature
 * @see specs/coding-agent/personal-usage.feature
 */

import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import { canonicalAttributes, stableStringify } from "@langwatch/metric-server/testing";
import {
  METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
  type MetricProcessingEvent,
} from "@langwatch/metric-contract";
import type { ContributeMetricFactsCommandData } from "@langwatch/coding-agent-contract";
import { createCodingAgentMetricFactsDispatchSubscriber } from "../coding-agent-metric-facts-dispatch.subscriber";

const SERIES_ID = "a".repeat(64);
const POINT_ID = "b".repeat(64);

/**
 * Encode attributes exactly the way build-point does — through
 * canonicalAttributes + stableStringify — so this suite drives the dispatcher
 * with the canonical KeyValue-array shape the pipeline actually stores, not a
 * hand-rolled flat object.
 */
function encodeAttributes(attributes: Record<string, unknown>): string {
  return stableStringify(
    canonicalAttributes(
      Object.entries(attributes).map(([key, value]) => ({
        key,
        value:
          typeof value === "boolean"
            ? { boolValue: value }
            : typeof value === "number"
              ? { doubleValue: value }
              : { stringValue: String(value) },
      })),
    ),
  );
}

function dataPointEvent({
  metricName,
  attributes = {},
  temporality = "cumulative",
  valueDouble = null,
  valueInt = null,
  pointId = POINT_ID,
  seriesId = SERIES_ID,
  resourceAttributes = {},
}: {
  metricName: string;
  attributes?: Record<string, unknown>;
  temporality?: "delta" | "cumulative" | "unspecified";
  valueDouble?: number | null;
  valueInt?: string | null;
  pointId?: string;
  seriesId?: string;
  resourceAttributes?: Record<string, unknown>;
}): MetricProcessingEvent {
  return {
    tenantId: createTenantId("tenant-1"),
    type: METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
    occurredAt: 1_500,
    data: {
      tenantId: "tenant-1",
      pointId,
      seriesId,
      metricName,
      metricUnit: "USD",
      metricKind: "sum",
      aggregationTemporality: temporality,
      scopeName: "com.anthropic.claude_code",
      pointAttributesJson: encodeAttributes(attributes),
      resourceAttributesJson: encodeAttributes(resourceAttributes),
      timeUnixMs: 1_500,
      valueType: valueDouble !== null ? "double" : valueInt !== null ? "int" : "none",
      valueDouble,
      valueInt,
    },
  } as unknown as MetricProcessingEvent;
}

function makeSubscriber() {
  const dispatched: ContributeMetricFactsCommandData[] = [];
  const subscriber = createCodingAgentMetricFactsDispatchSubscriber({
    contributeMetricFacts: async (data) => {
      dispatched.push(data);
    },
  });
  return { subscriber, dispatched };
}

const context = { tenantId: "tenant-1", aggregateId: POINT_ID };

describe("codingAgentMetricFactsDispatch", () => {
  describe("when the same canonical metric point is redelivered", () => {
    it("resolves to one converged series contribution", async () => {
      const { subscriber, dispatched } = makeSubscriber();
      const event = dataPointEvent({
        metricName: "claude_code.cost.usage",
        attributes: { "session.id": "sess-redelivery" },
        valueDouble: 1.25,
      });

      await subscriber.handle(event, context);
      await subscriber.handle(event, context);

      const durable = new Map(
        dispatched.map((contribution) => [
          `${contribution.tenantId}:${contribution.sessionId}:${contribution.seriesId}`,
          contribution,
        ]),
      );
      expect(dispatched).toHaveLength(2);
      expect(durable.size).toBe(1);
    });
  });

  describe("when a Cowork session's metric arrives", () => {
    /** @scenario Cowork telemetry that shares Claude Code's event vocabulary is still Cowork */
    it("labels the contribution claude_cowork from the resource service", async () => {
      const { subscriber, dispatched } = makeSubscriber();

      // Claude Code's metric vocabulary and scope; only the resource-level
      // service.name says cowork. Without the service signal this would
      // first-writer-win the session's agent to claude_code.
      await subscriber.handle(
        dataPointEvent({
          metricName: "claude_code.cost.usage",
          attributes: { "session.id": "cw-sess-1" },
          temporality: "cumulative",
          valueDouble: 0.5,
          resourceAttributes: { "service.name": "cowork" },
        }),
        context,
      );

      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]!.agent).toBe("claude_cowork");
      expect(dispatched[0]!.sessionId).toBe("cw-sess-1");
    });
  });

  describe("when a cumulative coding-agent metric carries the session key", () => {
    /** @scenario a session that sent only metrics still appears */
    it("contributes the series' converged total, keyed by the series", async () => {
      const { subscriber, dispatched } = makeSubscriber();

      await subscriber.handle(
        dataPointEvent({
          metricName: "claude_code.cost.usage",
          attributes: { "session.id": "sess-1", model: "claude-fable-5" },
          temporality: "cumulative",
          valueDouble: 1.25,
        }),
        context,
      );

      expect(dispatched).toHaveLength(1);
      const [contribution] = dispatched;
      expect(contribution!.sessionId).toBe("sess-1");
      expect(contribution!.seriesId).toBe(SERIES_ID);
      expect(contribution!.value).toBe(1.25);
      expect(contribution!.agent).toBe("claude_code");
      expect(contribution!.attributes.model).toBe("claude-fable-5");
    });
  });

  describe("when the same counter arrives as delta points", () => {
    // A delta must sum exactly once, so each point is its own converged
    // unit — a re-delivery replaces that one row instead of adding to it.
    it("keys the contribution by the point, not the series", async () => {
      const { subscriber, dispatched } = makeSubscriber();

      await subscriber.handle(
        dataPointEvent({
          metricName: "claude_code.lines_of_code.count",
          attributes: { "session.id": "sess-1", type: "added" },
          temporality: "delta",
          valueInt: "42",
        }),
        context,
      );

      expect(dispatched[0]!.seriesId).toBe(POINT_ID);
      expect(dispatched[0]!.value).toBe(42);
    });
  });

  describe("when a coding-agent metric carries no session key", () => {
    // Codex and Copilot metrics are fleet-level by design upstream; they
    // stay in the canonical metric tables.
    it("contributes nothing", async () => {
      const { subscriber, dispatched } = makeSubscriber();

      await subscriber.handle(
        dataPointEvent({
          metricName: "claude_code.token.usage",
          attributes: { type: "input" },
          valueInt: "100",
        }),
        context,
      );

      expect(dispatched).toHaveLength(0);
    });
  });

  describe("when an unrelated metric passes by", () => {
    it("is ignored", async () => {
      const { subscriber, dispatched } = makeSubscriber();

      await subscriber.handle(
        dataPointEvent({
          metricName: "http.server.duration",
          attributes: { "session.id": "sess-1" },
          valueDouble: 12,
        }),
        context,
      );

      expect(dispatched).toHaveLength(0);
    });
  });
});
