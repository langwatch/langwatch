import { describe, expect, it } from "vitest";

import {
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";

import { SpanStatusService } from "../span-status.service";

function makeSpan(overrides: Partial<NormalizedSpan> = {}): NormalizedSpan {
  return {
    id: "test-id",
    traceId: "trace-123",
    spanId: "span-456",
    tenantId: "tenant-1",
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 1000,
    endTimeUnixMs: 2000,
    durationMs: 1000,
    name: "test-span",
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: {},
    spanAttributes: {},
    events: [],
    links: [],
    statusMessage: null,
    statusCode: null,
    instrumentationScope: { name: "test", version: null },
    droppedAttributesCount: 0 as 0,
    droppedEventsCount: 0 as 0,
    droppedLinksCount: 0 as 0,
    ...overrides,
  };
}

describe("SpanStatusService.extractStatus", () => {
  const service = new SpanStatusService();

  describe("when the span carries an exception event and a statusMessage", () => {
    it("prefers the exception event's exception.message over statusMessage (Thread-tab #78 regression)", () => {
      // Regression: the Thread-tab trace-level error renderer reads from
      // TraceSummary.errorMessage, which this service populates. Before
      // the fix, statusMessage ("Bad Request") won over the event — so
      // the rich "provider X not bound" text never reached the UI even
      // though the gateway wrote it to span.events. Parallels the
      // span.mapper fix in 531f31721.
      const span = makeSpan({
        statusCode: NormalizedStatusCode.ERROR,
        statusMessage: "Bad Request",
        events: [
          {
            name: "exception",
            timeUnixMs: 1500,
            attributes: {
              "exception.type": "provider_not_bound",
              "exception.message":
                "provider openai not bound to this virtual key — define an alias",
            },
          },
        ],
      });

      const result = service.extractStatus(span);

      expect(result.hasError).toBe(true);
      expect(result.errorMessage).toBe(
        "provider openai not bound to this virtual key — define an alias",
      );
    });
  });

  describe("when the span carries only statusMessage (no event, no attrs)", () => {
    it("falls back to statusMessage", () => {
      const span = makeSpan({
        statusCode: NormalizedStatusCode.ERROR,
        statusMessage: "Bad Request",
      });

      const result = service.extractStatus(span);

      expect(result.hasError).toBe(true);
      expect(result.errorMessage).toBe("Bad Request");
    });
  });

  describe("when the span carries only the span-level exception.message attribute", () => {
    it("uses the attribute", () => {
      const span = makeSpan({
        statusCode: NormalizedStatusCode.ERROR,
        spanAttributes: {
          "exception.message": "upstream timeout after 30s",
        },
      });

      const result = service.extractStatus(span);

      expect(result.errorMessage).toBe("upstream timeout after 30s");
      expect(result.hasError).toBe(true);
    });
  });

  describe("when the span carries multiple exception events", () => {
    it("picks the newest exception event (final fatal error after fallbacks)", () => {
      const span = makeSpan({
        statusCode: NormalizedStatusCode.ERROR,
        events: [
          {
            name: "exception",
            timeUnixMs: 1000,
            attributes: { "exception.message": "first transient" },
          },
          {
            name: "exception",
            timeUnixMs: 1500,
            attributes: { "exception.message": "final fatal" },
          },
        ],
      });

      const result = service.extractStatus(span);

      expect(result.errorMessage).toBe("final fatal");
    });
  });

  describe("when the exception event carries an empty exception.message", () => {
    it("skips it and falls back to statusMessage", () => {
      const span = makeSpan({
        statusCode: NormalizedStatusCode.ERROR,
        statusMessage: "Bad Request",
        events: [
          {
            name: "exception",
            timeUnixMs: 1500,
            attributes: { "exception.message": "" },
          },
        ],
      });

      const result = service.extractStatus(span);

      expect(result.errorMessage).toBe("Bad Request");
    });
  });

  describe("when statusCode is OK", () => {
    it("reports OK without an error message", () => {
      const span = makeSpan({ statusCode: NormalizedStatusCode.OK });

      const result = service.extractStatus(span);

      expect(result.hasOK).toBe(true);
      expect(result.hasError).toBe(false);
      expect(result.errorMessage).toBeNull();
    });
  });

  describe("when only an error.has_error attribute is set", () => {
    it("marks hasError without a message", () => {
      const span = makeSpan({
        spanAttributes: { "error.has_error": true },
      });

      const result = service.extractStatus(span);

      expect(result.hasError).toBe(true);
      expect(result.errorMessage).toBeNull();
    });
  });
});
