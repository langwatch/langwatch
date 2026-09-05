import { describe, expect, it } from "vitest";
import { createTenantId, type Command } from "@langwatch/eventing";
import {
  RECORD_SPAN_COMMAND_TYPE,
  type OtlpSpan,
  type RecordSpanCommandData,
} from "@langwatch/trace-contract";
import {
  EventingRecordSpanAdapter,
  type RecordSpanCommandOptions,
} from "../eventing.record-span.adapter";
import type {
  TraceSpanContentDropPort,
  TraceSpanCostEnrichmentPort,
  TraceSpanPiiRedactionPort,
  TraceSpanTokenEstimationPort,
} from "../../ports/trace-span-preparation.port";

function createSpan(attributes: OtlpSpan["attributes"]): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name: "test-span",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 0, high: 0 },
    attributes,
    events: [],
    links: [],
    status: { message: null, code: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

function createCommand(attributes: OtlpSpan["attributes"]): Command<RecordSpanCommandData> {
  const data: RecordSpanCommandData = {
    tenantId: "project-123",
    span: createSpan(attributes),
    resource: null,
    instrumentationScope: null,
    occurredAt: Date.now(),
  };
  return {
    tenantId: createTenantId("project-123"),
    aggregateId: "trace-1",
    type: RECORD_SPAN_COMMAND_TYPE,
    data,
  };
}

function createOptions(mutatingPiiRedact: (span: OtlpSpan) => void): RecordSpanCommandOptions {
  const piiRedaction: TraceSpanPiiRedactionPort = {
    redact: async (span) => {
      mutatingPiiRedact(span);
    },
  };
  const costEnrichment: TraceSpanCostEnrichmentPort = { enrich: async () => undefined };
  const tokenEstimation: TraceSpanTokenEstimationPort = { estimate: async () => undefined };
  const contentDrop: TraceSpanContentDropPort = {
    drop: async () => ({ droppedCount: 0, droppedCategories: [] }),
  };
  return { piiRedaction, costEnrichment, tokenEstimation, contentDrop };
}

describe("EventingRecordSpanAdapter", () => {
  describe("given a redaction pass that mutates the span it is handed", () => {
    /** @scenario "Does not mutate original command data" */
    it("does not mutate the original command data", async () => {
      const command = createCommand([{ key: "gen_ai.prompt", value: { stringValue: "original" } }]);
      const originalValue = command.data.span.attributes[0]!.value.stringValue;
      const options = createOptions((span) => {
        span.attributes[0]!.value.stringValue = "[REDACTED]";
      });
      const handler = EventingRecordSpanAdapter.create(options);

      await handler.handle(command);

      expect(command.data.span.attributes[0]!.value.stringValue).toBe(originalValue);
    });
  });

  describe("given a span carrying a user-submitted reserved attribute", () => {
    /** @scenario "Strips user-submitted langwatch.reserved.* attributes from spans" */
    it("strips langwatch.reserved.* attributes from the emitted span", async () => {
      const command = createCommand([
        {
          key: "langwatch.reserved.pii_redaction_status",
          value: { stringValue: "true" },
        },
        { key: "gen_ai.prompt", value: { stringValue: "hello" } },
      ]);
      const options = createOptions(() => undefined);
      const handler = EventingRecordSpanAdapter.create(options);

      const [event] = await handler.handle(command);

      const emittedAttributes = event!.data.span.attributes;
      expect(
        emittedAttributes.find((a) => a.key === "langwatch.reserved.pii_redaction_status"),
      ).toBeUndefined();
      expect(emittedAttributes.find((a) => a.key === "gen_ai.prompt")).toBeDefined();
    });
  });
});
