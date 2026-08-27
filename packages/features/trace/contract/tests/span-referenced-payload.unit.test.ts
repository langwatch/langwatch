import { describe, expect, it } from "vitest";
import {
  makeSpanReferencedPayload,
  parseSpanReferencedPayload,
  SPAN_REFERENCED_PAYLOAD_TYPE,
  type SpanReceivedEvent,
} from "../src/index";

const makeEvent = (startTimeUnixNano: unknown): SpanReceivedEvent =>
  ({
    id: "evt_01",
    aggregateId: "trace_01",
    aggregateType: "trace",
    tenantId: "project_01",
    createdAt: 1_800_000_000_000,
    occurredAt: 1_800_000_000_000,
    type: "lw.obs.trace.span_received",
    version: "2026-07-24",
    data: {
      span: {
        spanId: "span_01",
        name: "synthetic span",
        startTimeUnixNano,
        attributes: { "synthetic.attribute": "value" },
      },
    },
  }) as unknown as SpanReceivedEvent;

describe("given a span_received event staged as a reference", () => {
  describe("when the wire start time is unparseable", () => {
    const staged = makeSpanReferencedPayload(makeEvent("not-a-number"));

    it("stages a reference rather than the raw event", () => {
      expect(staged.type).toBe(SPAN_REFERENCED_PAYLOAD_TYPE);
      expect(parseSpanReferencedPayload(staged)).not.toBeNull();
    });

    it("carries no raw span payload", () => {
      expect(staged.data).not.toHaveProperty("span");
      expect(JSON.stringify(staged)).not.toContain("synthetic.attribute");
    });

    it("keeps the durable identity the event-store lookup is keyed by", () => {
      expect(staged.id).toBe("evt_01");
      expect(staged.aggregateId).toBe("trace_01");
      expect(staged.aggregateType).toBe("trace");
      expect(staged.tenantId).toBe("project_01");
    });

    it("reports the unparseable start as null instead of degrading", () => {
      expect(staged.data.startTimeUnixMs).toBeNull();
    });
  });

  describe("when the wire start time is readable", () => {
    const staged = makeSpanReferencedPayload(makeEvent(1_800_000_000_000_000_000));

    it("stages a reference", () => {
      expect(staged.type).toBe(SPAN_REFERENCED_PAYLOAD_TYPE);
    });

    it("parses the start time when the wire value is readable", () => {
      expect(staged.data.startTimeUnixMs).toBe(1_800_000_000_000);
    });
  });
});
