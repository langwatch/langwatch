/**
 * Unit tests for `leanForProjection` — ADR-022 §"Interposition derives lean shapes".
 *
 * These tests FAIL at unit runtime (leanForProjection throws "not implemented")
 * but pass typecheck. They are the TDD contract for Step 5 of the ADR-022
 * implementation plan.
 *
 * BDD structure: describe("given X") → describe("when Y") → it("…").
 * No "should" in it() names (project convention).
 */

import { describe, it, expect } from "vitest";
import {
  leanForProjection,
  IO_PREVIEW_BYTES,
  IO_ATTR_KEYS,
  EVENTREF_ATTR_PREFIX,
} from "../lean-for-projection";
import type { Event } from "~/server/event-sourcing";
import { createTenantId } from "~/server/event-sourcing";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
  ANNOTATION_ADDED_EVENT_TYPE,
  ANNOTATION_ADDED_EVENT_VERSION_LATEST,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_EVENT_FIELDS = {
  id: "evt-001",
  aggregateId: "trace-aaa",
  aggregateType: "trace" as const,
  tenantId: createTenantId("tenant-001"),
  createdAt: 1700000000000,
  occurredAt: 1700000000000,
};

/** 100 KB string — well over IO_PREVIEW_BYTES (64 KB). */
const LARGE_VALUE = "x".repeat(100 * 1024);

/** 10 KB string — under IO_PREVIEW_BYTES. */
const SMALL_VALUE = "y".repeat(10 * 1024);

function makeSpanReceivedEvent({
  attributes,
}: {
  attributes: Record<string, string>;
}): Event {
  return {
    ...BASE_EVENT_FIELDS,
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
    data: {
      span: {
        traceId: "aaaaaaaaaaaaaaaa",
        spanId: "bbbbbbbbbbbbbbbb",
        name: "test-span",
        kind: 1,
        startTimeUnixNano: "1700000000000000000",
        endTimeUnixNano: "1700000001000000000",
        attributes: Object.entries(attributes).map(([key, value]) => ({
          key,
          value: { stringValue: value },
        })),
        events: [],
        links: [],
        status: { code: 1, message: null },
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      },
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "DISABLED",
    },
    metadata: { spanId: "bbbbbbbbbbbbbbbb", traceId: "aaaaaaaaaaaaaaaa" },
  };
}

function makeLogRecordReceivedEvent({ body }: { body: string }): Event {
  return {
    ...BASE_EVENT_FIELDS,
    type: LOG_RECORD_RECEIVED_EVENT_TYPE,
    version: LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
    data: {
      traceId: "aaaaaaaaaaaaaaaa",
      spanId: "bbbbbbbbbbbbbbbb",
      timeUnixMs: 1700000000000,
      severityNumber: 9,
      severityText: "INFO",
      body,
      attributes: {},
      resourceAttributes: {},
      scopeName: "test",
      scopeVersion: null,
      piiRedactionLevel: "DISABLED",
    },
  };
}

function makeAnnotationAddedEvent(): Event {
  return {
    ...BASE_EVENT_FIELDS,
    type: ANNOTATION_ADDED_EVENT_TYPE,
    version: ANNOTATION_ADDED_EVENT_VERSION_LATEST,
    data: {
      traceId: "aaaaaaaaaaaaaaaa",
      annotationId: "ann-001",
    },
  };
}

/** Extract span attributes as a Record from a SpanReceived event returned by leanForProjection. */
function extractSpanAttributes(event: Event): Record<string, string> {
  const data = event.data as { span: { attributes?: Array<{ key: string; value: { stringValue?: string } }> } };
  const result: Record<string, string> = {};
  for (const attr of data.span.attributes ?? []) {
    if (typeof attr.value.stringValue === "string") {
      result[attr.key] = attr.value.stringValue;
    }
  }
  return result;
}

/** Extract log body from a LogRecordReceived event returned by leanForProjection. */
function extractLogBody(event: Event): string {
  const data = event.data as { body: string };
  return data.body;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

/**
 * @scenario leanForProjection is the single source of truth for the lean shape
 */
describe("given a SpanReceived event with a 100 KB langwatch.output", () => {
  describe("when leanForProjection is applied", () => {
    it("returns event with langwatch.output length ≤ IO_PREVIEW_BYTES + 4 bytes for ellipsis", () => {
      const event = makeSpanReceivedEvent({
        attributes: { "langwatch.output": LARGE_VALUE },
      });

      const leaned = leanForProjection(event);
      const attrs = extractSpanAttributes(leaned);

      expect(Buffer.byteLength(attrs["langwatch.output"] ?? "", "utf-8")).toBeLessThanOrEqual(
        IO_PREVIEW_BYTES + 4,
      );
    });

    it("attaches a langwatch.reserved.eventref.langwatch.output attr containing { field: 'langwatch.output' }", () => {
      const event = makeSpanReceivedEvent({
        attributes: { "langwatch.output": LARGE_VALUE },
      });

      const leaned = leanForProjection(event);
      const attrs = extractSpanAttributes(leaned);
      const eventrefKey = `${EVENTREF_ATTR_PREFIX}langwatch.output`;

      expect(attrs[eventrefKey]).toBeDefined();
      const ref = JSON.parse(attrs[eventrefKey]!) as { field: string };
      expect(ref.field).toBe("langwatch.output");
    });
  });
});

describe("given a SpanReceived event with a 10 KB langwatch.output (under IO_PREVIEW_BYTES)", () => {
  describe("when leanForProjection is applied", () => {
    it("returns the event unchanged (no preview truncation, no eventref attached)", () => {
      const event = makeSpanReceivedEvent({
        attributes: { "langwatch.output": SMALL_VALUE },
      });

      const leaned = leanForProjection(event);
      const attrs = extractSpanAttributes(leaned);

      expect(attrs["langwatch.output"]).toBe(SMALL_VALUE);
      expect(attrs[`${EVENTREF_ATTR_PREFIX}langwatch.output`]).toBeUndefined();
    });
  });
});

describe("given a SpanReceived event with no IO attrs", () => {
  describe("when leanForProjection is applied", () => {
    it("returns the event unchanged", () => {
      const event = makeSpanReceivedEvent({
        attributes: { "custom.attr": "some value" },
      });

      const leaned = leanForProjection(event);
      const attrs = extractSpanAttributes(leaned);

      expect(attrs["custom.attr"]).toBe("some value");
      // No eventref should be present
      const eventrefKeys = Object.keys(attrs).filter((k) =>
        k.startsWith(EVENTREF_ATTR_PREFIX),
      );
      expect(eventrefKeys).toHaveLength(0);
    });
  });
});

describe("given a LogRecordReceived event with a 100 KB body", () => {
  describe("when leanForProjection is applied", () => {
    it("truncates the body to ≤ IO_PREVIEW_BYTES + 4 bytes and attaches eventref.body", () => {
      const event = makeLogRecordReceivedEvent({ body: LARGE_VALUE });

      const leaned = leanForProjection(event);
      const body = extractLogBody(leaned);
      const data = leaned.data as { attributes?: Record<string, string> };

      expect(Buffer.byteLength(body, "utf-8")).toBeLessThanOrEqual(
        IO_PREVIEW_BYTES + 4,
      );
      // eventref.body is stored in the event data attributes
      expect(data.attributes?.["langwatch.reserved.eventref.body"]).toBeDefined();
      const ref = JSON.parse(
        data.attributes!["langwatch.reserved.eventref.body"]!,
      ) as { field: string };
      expect(ref.field).toBe("body");
    });
  });
});

describe("given a TraceAnnotationAdded event (non-IO event type)", () => {
  describe("when leanForProjection is applied", () => {
    it("returns the event unchanged (pass-through)", () => {
      const event = makeAnnotationAddedEvent();

      const leaned = leanForProjection(event);

      expect(leaned).toEqual(event);
    });
  });
});

describe("given a SpanReceived event with both langwatch.input and langwatch.output exceeding IO_PREVIEW_BYTES", () => {
  describe("when leanForProjection is applied", () => {
    it("leans each IO attr independently and attaches a separate eventref for each", () => {
      const event = makeSpanReceivedEvent({
        attributes: {
          "langwatch.input": LARGE_VALUE,
          "langwatch.output": LARGE_VALUE,
        },
      });

      const leaned = leanForProjection(event);
      const attrs = extractSpanAttributes(leaned);

      // Both previews are within budget
      expect(Buffer.byteLength(attrs["langwatch.input"] ?? "", "utf-8")).toBeLessThanOrEqual(
        IO_PREVIEW_BYTES + 4,
      );
      expect(Buffer.byteLength(attrs["langwatch.output"] ?? "", "utf-8")).toBeLessThanOrEqual(
        IO_PREVIEW_BYTES + 4,
      );

      // Each gets its own eventref
      expect(attrs[`${EVENTREF_ATTR_PREFIX}langwatch.input`]).toBeDefined();
      expect(attrs[`${EVENTREF_ATTR_PREFIX}langwatch.output`]).toBeDefined();

      const inputRef = JSON.parse(
        attrs[`${EVENTREF_ATTR_PREFIX}langwatch.input`]!,
      ) as { field: string };
      const outputRef = JSON.parse(
        attrs[`${EVENTREF_ATTR_PREFIX}langwatch.output`]!,
      ) as { field: string };

      expect(inputRef.field).toBe("langwatch.input");
      expect(outputRef.field).toBe("langwatch.output");
    });
  });
});

describe("given a SpanReceived event with gen_ai.input.messages exceeding IO_PREVIEW_BYTES", () => {
  describe("when leanForProjection is applied", () => {
    it("leans gen_ai.input.messages the same way as langwatch.input and attaches its eventref", () => {
      // Verify that gen_ai.input.messages is in IO_ATTR_KEYS
      expect(IO_ATTR_KEYS.has("gen_ai.input.messages")).toBe(true);

      const event = makeSpanReceivedEvent({
        attributes: { "gen_ai.input.messages": LARGE_VALUE },
      });

      const leaned = leanForProjection(event);
      const attrs = extractSpanAttributes(leaned);

      expect(Buffer.byteLength(attrs["gen_ai.input.messages"] ?? "", "utf-8")).toBeLessThanOrEqual(
        IO_PREVIEW_BYTES + 4,
      );
      const eventrefKey = `${EVENTREF_ATTR_PREFIX}gen_ai.input.messages`;
      expect(attrs[eventrefKey]).toBeDefined();
      const ref = JSON.parse(attrs[eventrefKey]!) as { field: string };
      expect(ref.field).toBe("gen_ai.input.messages");
    });
  });
});
