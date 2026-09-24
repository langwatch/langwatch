import type { CodingAgentReceivedSpan } from "@langwatch/coding-agent-contract";
import { createTenantId } from "@langwatch/eventing";
import {
  type NormalizedSpan,
  type OtlpSpan,
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
  type SpanReceivedEvent,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { createCodingAgentSpanFactsDispatchSubscriber } from "../coding-agent-span-facts-dispatch.subscriber.ts";

function spanEvent({ name, scopeName }: { name: string; scopeName: string }): SpanReceivedEvent {
  const span: OtlpSpan = {
    traceId: "trace-1",
    spanId: "span-1",
    parentSpanId: null,
    name,
    kind: 1,
    startTimeUnixNano: "1700000000000000000",
    endTimeUnixNano: "1700000001000000000",
    attributes: [],
    events: [],
    links: [],
    status: { code: null, message: null },
    flags: null,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: createTenantId("tenant-1"),
    createdAt: 1_700_000_000_000,
    occurredAt: 1_700_000_000_000,
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
    data: {
      span,
      resource: null,
      instrumentationScope: { name: scopeName, version: null },
      piiRedactionLevel: "STRICT",
    },
    metadata: { spanId: "span-1", traceId: "trace-1" },
  };
}

function subscriber(normalized: NormalizedSpan | Error) {
  const contributed: CodingAgentReceivedSpan[] = [];
  const definition = createCodingAgentSpanFactsDispatchSubscriber({
    normalize: () => {
      if (normalized instanceof Error) throw normalized;
      return normalized;
    },
    contributeReceivedSpan: async (input) => {
      contributed.push(input);
    },
  });
  return { definition, contributed };
}

const claudeTool = () =>
  spanEvent({ name: "claude_code.tool", scopeName: "com.anthropic.claude_code" });
const foreign = () => spanEvent({ name: "http.request", scopeName: "com.acme.pipeline" });

describe("the codingAgentSpanFactsDispatch subscriber", () => {
  describe("when the enqueue filter reads an event", () => {
    /** @scenario a matching event mints a job for the subscriber */
    it("admits a coding-agent span", () => {
      const { definition } = subscriber(new Error("unused"));
      expect(definition.options?.enqueue?.filter?.(claudeTool())).toBe(true);
    });

    /** @scenario a non-matching event never mints a job */
    it("declines a span no coding agent claims", () => {
      const { definition } = subscriber(new Error("unused"));
      expect(definition.options?.enqueue?.filter?.(foreign())).toBe(false);
    });
  });

  describe("given the same span event is delivered twice", () => {
    /** @scenario a redelivered event resolves to the unit of work already queued */
    it("keys both deliveries to one job per tenant, trace and span", () => {
      const { definition } = subscriber(new Error("unused"));
      const dedup = definition.options?.deduplication;
      if (typeof dedup !== "object" || dedup === null || !("makeId" in dedup)) {
        throw new Error("codingAgentSpanFactsDispatch declares no per-event dedup key");
      }
      const makeId = dedup.makeId;
      expect(makeId?.(claudeTool())).toBe(makeId?.(claudeTool()));
      expect(makeId?.(claudeTool())).toBe("coding-agent-span-facts:tenant-1:trace-1:span-1");
    });
  });

  describe("when the span fails normalization", () => {
    /** @scenario an event the subscriber declines is still completed quietly */
    it("completes without contributing", async () => {
      const { definition, contributed } = subscriber(new Error("unreadable span"));
      await expect(
        definition.handle(claudeTool(), {
          tenantId: createTenantId("tenant-1"),
          aggregateId: "trace-1",
        }),
      ).resolves.toBeUndefined();
      expect(contributed).toEqual([]);
    });
  });
});
