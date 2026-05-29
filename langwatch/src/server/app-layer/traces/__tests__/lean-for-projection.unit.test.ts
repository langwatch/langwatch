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
import { DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES } from "~/server/event-sourcing/pipelines/trace-processing/utils/capOversizedAttributes";
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

/**
 * Builds a SpanReceived event with raw OTLP-typed attribute values so tests can
 * supply nested `arrayValue`/`kvlistValue` shapes for capOversizedAttributes coverage.
 */
function makeSpanReceivedEventWithRawAttrs({
  attributes,
}: {
  attributes: Array<{ key: string; value: { stringValue?: string; arrayValue?: { values: Array<{ stringValue?: string }> }; kvlistValue?: { values: Array<{ key: string; value: { stringValue?: string } }> } } }>;
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        attributes: attributes as any,
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

// ---------------------------------------------------------------------------
// New tests: non-IO / nested / binary capping (ADR-022 spool-path fix)
// ---------------------------------------------------------------------------

/** A value that exceeds DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES (256 KB) but not IO_PREVIEW_BYTES is N/A:
 * DEFAULT > IO_PREVIEW, so a value > 256 KB is always > 64 KB too.
 * We make a 300 KB non-IO value — over both thresholds. IO_ATTR_KEYS won't match it,
 * so it goes through the 256 KB cap path, NOT the 64 KB IO preview path. */
const NON_IO_OVER_256KB = "z".repeat(300 * 1024);

/**
 * @scenario non-IO stringValue over 256 KB is capped in the lean output (spool-path fix)
 */
describe("given a SpanReceived event with a non-IO attribute (langwatch.params) whose stringValue exceeds 256 KB", () => {
  describe("when leanForProjection is applied", () => {
    it("caps the langwatch.params value in the leaned event to a placeholder", () => {
      const event = makeSpanReceivedEvent({
        attributes: { "langwatch.params": NON_IO_OVER_256KB },
      });

      const leaned = leanForProjection(event);
      const attrs = extractSpanAttributes(leaned);

      // The capped value must be a truncation placeholder, far shorter than the original
      expect(Buffer.byteLength(attrs["langwatch.params"] ?? "", "utf-8")).toBeLessThan(
        DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
      );
      expect(attrs["langwatch.params"]).toMatch(/\[truncated:/);
    });

    it("leaves the original input event's langwatch.params value unchanged (clone safety)", () => {
      const event = makeSpanReceivedEvent({
        attributes: { "langwatch.params": NON_IO_OVER_256KB },
      });
      const originalData = event.data as { span: { attributes: Array<{ key: string; value: { stringValue?: string } }> } };
      const originalValue = originalData.span.attributes.find(
        (a) => a.key === "langwatch.params",
      )?.value.stringValue;

      leanForProjection(event);

      // Original must be completely unmodified after leanForProjection
      const valueAfter = originalData.span.attributes.find(
        (a) => a.key === "langwatch.params",
      )?.value.stringValue;
      expect(valueAfter).toBe(originalValue);
      expect(valueAfter).toHaveLength(300 * 1024);
    });

    it("does not attach an eventref for the non-IO attribute", () => {
      const event = makeSpanReceivedEvent({
        attributes: { "langwatch.params": NON_IO_OVER_256KB },
      });

      const leaned = leanForProjection(event);
      const attrs = extractSpanAttributes(leaned);

      const eventrefKeys = Object.keys(attrs).filter((k) =>
        k.startsWith(EVENTREF_ATTR_PREFIX),
      );
      expect(eventrefKeys).toHaveLength(0);
    });
  });
});

/**
 * @scenario >256KB blob nested inside arrayValue of a NON-IO attribute is capped (spool-path fix)
 */
describe("given a SpanReceived event with a >256KB blob nested inside an arrayValue of a non-IO attribute", () => {
  describe("when leanForProjection is applied", () => {
    it("caps the nested blob in the lean output", () => {
      const event = makeSpanReceivedEventWithRawAttrs({
        attributes: [
          {
            key: "langwatch.params",
            value: {
              arrayValue: {
                values: [
                  { stringValue: NON_IO_OVER_256KB },
                  { stringValue: "small" },
                ],
              },
            },
          },
        ],
      });

      const leaned = leanForProjection(event);
      const leanedData = leaned.data as {
        span: {
          attributes: Array<{
            key: string;
            value: {
              arrayValue?: { values: Array<{ stringValue?: string }> };
            };
          }>;
        };
      };
      const leanedAttr = leanedData.span.attributes.find(
        (a) => a.key === "langwatch.params",
      );
      const firstItem = leanedAttr?.value.arrayValue?.values[0];

      expect(firstItem?.stringValue).toMatch(/\[truncated:/);
    });

    it("leaves the original nested blob value unchanged (clone safety)", () => {
      const event = makeSpanReceivedEventWithRawAttrs({
        attributes: [
          {
            key: "langwatch.params",
            value: {
              arrayValue: {
                values: [
                  { stringValue: NON_IO_OVER_256KB },
                ],
              },
            },
          },
        ],
      });

      const originalData = event.data as {
        span: {
          attributes: Array<{
            key: string;
            value: {
              arrayValue?: { values: Array<{ stringValue?: string }> };
            };
          }>;
        };
      };
      const originalNestedValue = originalData.span.attributes
        .find((a) => a.key === "langwatch.params")
        ?.value.arrayValue?.values[0]?.stringValue;

      leanForProjection(event);

      const valueAfter = originalData.span.attributes
        .find((a) => a.key === "langwatch.params")
        ?.value.arrayValue?.values[0]?.stringValue;

      expect(valueAfter).toBe(originalNestedValue);
      expect(valueAfter).toHaveLength(300 * 1024);
    });
  });
});

/**
 * @scenario IO attr (gen_ai.input.messages) with >64KB stringValue is still IO-previewed with eventref
 *           Regression guard: new non-IO capping must not break IO preview path.
 */
describe("given a SpanReceived event with gen_ai.input.messages exceeding IO_PREVIEW_BYTES (regression guard for new capping)", () => {
  describe("when leanForProjection is applied", () => {
    it("still previews gen_ai.input.messages to ≤ IO_PREVIEW_BYTES and attaches eventref", () => {
      const event = makeSpanReceivedEvent({
        attributes: { "gen_ai.input.messages": NON_IO_OVER_256KB },
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

    it("leaves the original input event's gen_ai.input.messages value unchanged (clone safety)", () => {
      const event = makeSpanReceivedEvent({
        attributes: { "gen_ai.input.messages": NON_IO_OVER_256KB },
      });
      const originalData = event.data as { span: { attributes: Array<{ key: string; value: { stringValue?: string } }> } };
      const originalValue = originalData.span.attributes.find(
        (a) => a.key === "gen_ai.input.messages",
      )?.value.stringValue;

      leanForProjection(event);

      const valueAfter = originalData.span.attributes.find(
        (a) => a.key === "gen_ai.input.messages",
      )?.value.stringValue;
      expect(valueAfter).toBe(originalValue);
      expect(valueAfter).toHaveLength(300 * 1024);
    });
  });
});

/**
 * @scenario sub-threshold event — no-op, no allocations (hot-path guard)
 */
describe("given a SpanReceived event where all attributes are under both thresholds", () => {
  describe("when leanForProjection is applied", () => {
    it("returns the same event reference (no-op, no extra allocation)", () => {
      const event = makeSpanReceivedEvent({
        attributes: {
          "custom.attr": "hello",
          "langwatch.params": "small params",
        },
      });

      const leaned = leanForProjection(event);

      // No IO oversize, no non-IO oversize → same object reference returned
      expect(leaned).toBe(event);
    });
  });
});

/**
 * @scenario small structured non-IO attr — must not trigger clone (hot-path guard)
 *
 * Before the fix, ANY non-IO arrayValue/kvlistValue with length > 0 forced a
 * structuredClone regardless of the actual content size. After the fix, the
 * attrValueExceeds probe recurses into the nested values — a small structured
 * attr is a no-op.
 */
describe("given a span with a small structured non-IO attribute", () => {
  describe("when leanForProjection is applied to an event with a small kvlistValue non-IO attr", () => {
    it("returns the same event reference without cloning", () => {
      const event = makeSpanReceivedEventWithRawAttrs({
        attributes: [
          {
            key: "langwatch.params",
            value: {
              kvlistValue: {
                values: [
                  { key: "model", value: { stringValue: "gpt-4o" } },
                  { key: "temperature", value: { stringValue: "0.7" } },
                ],
              },
            },
          },
        ],
      });

      const result = leanForProjection(event);

      expect(result).toBe(event);
    });
  });

  describe("when leanForProjection is applied to an event with a small arrayValue non-IO attr", () => {
    it("returns the same event reference without cloning", () => {
      const event = makeSpanReceivedEventWithRawAttrs({
        attributes: [
          {
            key: "custom.tags",
            value: {
              arrayValue: {
                values: [
                  { stringValue: "production" },
                  { stringValue: "v2" },
                ],
              },
            },
          },
        ],
      });

      const result = leanForProjection(event);

      expect(result).toBe(event);
    });
  });

  describe("when leanForProjection is applied to an event with a nested >256KB value inside kvlistValue", () => {
    it("caps the nested blob (attrValueExceeds still flags genuinely-oversized nested values)", () => {
      const event = makeSpanReceivedEventWithRawAttrs({
        attributes: [
          {
            key: "langwatch.params",
            value: {
              kvlistValue: {
                values: [
                  { key: "blob", value: { stringValue: NON_IO_OVER_256KB } },
                ],
              },
            },
          },
        ],
      });

      const leaned = leanForProjection(event);

      // Must NOT return same reference — a clone is required for the oversized nested value
      expect(leaned).not.toBe(event);

      const leanedData = leaned.data as {
        span: {
          attributes: Array<{
            key: string;
            value: {
              kvlistValue?: { values: Array<{ key: string; value: { stringValue?: string } }> };
            };
          }>;
        };
      };
      const leanedAttr = leanedData.span.attributes.find(
        (a) => a.key === "langwatch.params",
      );
      const blobEntry = leanedAttr?.value.kvlistValue?.values.find(
        (e) => e.key === "blob",
      );

      expect(blobEntry?.value.stringValue).toMatch(/\[truncated:/);
    });
  });
});
