/**
 * What the record-span command keeps of a large attribute value before event_log.
 * @see specs/trace-processing/oversized-attribute-value-preview.feature
 */
import { createTenantId, type Command } from "@langwatch/eventing";
import type { OtlpSpan } from "@langwatch/otlp/trace-request";
import {
  RECORD_SPAN_COMMAND_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
  spanReceivedEventSchema,
  TRUNCATED_ATTRIBUTES_KEY,
  type RecordSpanCommandData,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  anthropicContentSpan,
  anthropicInputMessages,
} from "../../__tests__/support/anthropic-content-span.fixture.ts";
import { MAX_RECORDED_ATTRIBUTE_VALUE_BYTES } from "../../rules/trace-attribute-cap.rules.ts";
import { EventingRecordSpanAdapter, type TraceSpanSpool } from "../record-span.commands.ts";

const MB = 1024 * 1024;

function recorder(spool?: TraceSpanSpool): EventingRecordSpanAdapter {
  return EventingRecordSpanAdapter.create({
    piiRedaction: { redact: async () => {} },
    costEnrichment: { enrich: async () => {} },
    tokenEstimation: { estimate: async () => {} },
    contentDrop: { drop: async () => ({ droppedCount: 0, droppedCategories: [] }) },
    spool,
  });
}

function commandFor(
  span: OtlpSpan,
  overrides: Partial<RecordSpanCommandData> = {},
): Command<RecordSpanCommandData> {
  const data: RecordSpanCommandData = {
    tenantId: "project-1",
    occurredAt: 1_700_000_000_000,
    span,
    resource: null,
    instrumentationScope: null,
    ...overrides,
  };
  return {
    type: RECORD_SPAN_COMMAND_TYPE,
    tenantId: createTenantId(data.tenantId),
    aggregateId: span.traceId,
    data,
  };
}

async function recordedAttributes(
  command: Command<RecordSpanCommandData>,
  spool?: TraceSpanSpool,
): Promise<Map<string, string | undefined>> {
  const events = await recorder(spool).handle(command);
  const event = spanReceivedEventSchema.parse(
    events.find((candidate) => candidate.type === SPAN_RECEIVED_EVENT_TYPE),
  );
  return new Map(
    event.data.span.attributes.map((attr) => [attr.key, attr.value.stringValue ?? undefined]),
  );
}

function spanWithInput(inputBytes: number): OtlpSpan {
  return anthropicContentSpan({ traceId: "trace-1", spanId: "span-1", inputBytes });
}

describe("EventingRecordSpanAdapter attribute cap", () => {
  describe("given a default Anthropic span with 0.75 MB of input messages", () => {
    /** @scenario "A default Anthropic content span is recorded whole" */
    it("records gen_ai.input.messages byte for byte and names no truncation", async () => {
      const attributes = await recordedAttributes(commandFor(spanWithInput(0.75 * MB)));

      expect(attributes.get("gen_ai.input.messages")).toBe(anthropicInputMessages(0.75 * MB));
      expect(attributes.has(TRUNCATED_ATTRIBUTES_KEY)).toBe(false);
    });
  });

  describe("given an Anthropic span with a full 1M-token context of about 4 MB", () => {
    /** @scenario "A full 1M-token context span is recorded whole" */
    it("records gen_ai.input.messages byte for byte", async () => {
      const attributes = await recordedAttributes(commandFor(spanWithInput(4 * MB)));

      expect(attributes.get("gen_ai.input.messages")).toBe(anthropicInputMessages(4 * MB));
      expect(attributes.has(TRUNCATED_ATTRIBUTES_KEY)).toBe(false);
    });
  });

  describe("given a value over the recorded cap", () => {
    const overCap = MAX_RECORDED_ATTRIBUTE_VALUE_BYTES + 1024;

    /** @scenario "A value over the record cap is cut and the span names it" */
    it("replaces the value with the placeholder and names it with its original size", async () => {
      const attributes = await recordedAttributes(commandFor(spanWithInput(overCap)));

      expect(attributes.get("gen_ai.input.messages")).toBe(`[truncated: ${overCap} bytes]`);
      expect(JSON.parse(attributes.get(TRUNCATED_ATTRIBUTES_KEY) ?? "[]")).toEqual([
        { key: "gen_ai.input.messages", bytes: overCap },
      ]);
    });

    it("applies the same cap to a span reconstituted from the edge spool", async () => {
      const span = spanWithInput(overCap);
      const spool: TraceSpanSpool = {
        read: async () => JSON.stringify({ span, resource: null, instrumentationScope: null }),
        delete: async () => {},
      };

      const attributes = await recordedAttributes(
        commandFor({ ...span, attributes: [] }, { spoolRef: "sha256:abc" }),
        spool,
      );

      expect(attributes.get("gen_ai.input.messages")).toBe(`[truncated: ${overCap} bytes]`);
      expect(attributes.has(TRUNCATED_ATTRIBUTES_KEY)).toBe(true);
    });
  });

  describe("given a span that arrives with its own truncation marker", () => {
    const forged = JSON.stringify([{ key: "gen_ai.input.messages", bytes: 999 }]);

    /** @scenario "A client cannot send its own truncation marker" */
    it("drops the marker when nothing was cut", async () => {
      const span = spanWithInput(1024);
      span.attributes.push({ key: TRUNCATED_ATTRIBUTES_KEY, value: { stringValue: forged } });

      const attributes = await recordedAttributes(commandFor(span));

      expect(attributes.has(TRUNCATED_ATTRIBUTES_KEY)).toBe(false);
    });

    /** @scenario "A client cannot send its own truncation marker" */
    it("names only what the cap cut", async () => {
      const overCap = MAX_RECORDED_ATTRIBUTE_VALUE_BYTES + 1024;
      const span = spanWithInput(overCap);
      span.attributes.push({ key: TRUNCATED_ATTRIBUTES_KEY, value: { stringValue: forged } });

      const attributes = await recordedAttributes(commandFor(span));

      expect(JSON.parse(attributes.get(TRUNCATED_ATTRIBUTES_KEY) ?? "[]")).toEqual([
        { key: "gen_ai.input.messages", bytes: overCap },
      ]);
    });
  });
});
