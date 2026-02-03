import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantId, type Command } from "../../../../library";
import type { PIIRedactionLevel, RecordSpanCommandData } from "../../schemas/commands";
import {
  RECORD_SPAN_COMMAND_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "../../schemas/constants";
import {
  RecordSpanCommand,
  type RecordSpanCommandDependencies,
} from "../recordSpanCommand";

function createMockCommand(
  tenantId: string,
  traceId: string,
  spanId: string,
  attributes: Array<{ key: string; value: { stringValue?: string } }> = [],
  piiRedactionLevel?: PIIRedactionLevel,
): Command<RecordSpanCommandData> {
  return {
    type: RECORD_SPAN_COMMAND_TYPE,
    aggregateId: traceId,
    tenantId: createTenantId(tenantId),
    data: {
      tenantId,
      span: {
        traceId,
        spanId,
        name: "test-span",
        kind: 1,
        startTimeUnixNano: { low: 0, high: 0 },
        endTimeUnixNano: { low: 1000000, high: 0 },
        attributes,
        events: [],
        links: [],
        status: {},
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      },
      resource: {
        attributes: [],
      },
      instrumentationScope: {
        name: "test-scope",
      },
      piiRedactionLevel,
    },
  };
}

function createMockDependencies(): {
  deps: RecordSpanCommandDependencies;
  mockRedactSpan: ReturnType<typeof vi.fn>;
} {
  const mockRedactSpan = vi.fn();

  return {
    deps: {
      piiRedactionService: {
        redactSpan: mockRedactSpan,
      },
    },
    mockRedactSpan,
  };
}

describe("RecordSpanCommand", () => {
  let handler: RecordSpanCommand;
  let mockRedactSpan: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    const { deps, mockRedactSpan: mock } = createMockDependencies();
    mockRedactSpan = mock;
    handler = new RecordSpanCommand(deps);
  });

  describe("handle", () => {
    describe("PII redaction", () => {
      it("calls PII redaction service with piiRedactionLevel from command", async () => {
        const command = createMockCommand(
          "project-123",
          "trace-1",
          "span-1",
          [{ key: "gen_ai.prompt", value: { stringValue: "sensitive data" } }],
          "STRICT",
        );

        await handler.handle(command);

        expect(mockRedactSpan).toHaveBeenCalledWith(
          expect.objectContaining({ traceId: "trace-1", spanId: "span-1" }),
          "STRICT",
        );
      });

      it("defaults to ESSENTIAL when piiRedactionLevel is not provided", async () => {
        const command = createMockCommand("project-456", "trace-1", "span-1");

        await handler.handle(command);

        expect(mockRedactSpan).toHaveBeenCalledWith(
          expect.any(Object),
          "ESSENTIAL",
        );
      });

      it("uses DISABLED level when specified", async () => {
        const command = createMockCommand(
          "project-789",
          "trace-1",
          "span-1",
          [],
          "DISABLED",
        );

        await handler.handle(command);

        expect(mockRedactSpan).toHaveBeenCalledWith(
          expect.any(Object),
          "DISABLED",
        );
      });
    });

    describe("event creation", () => {
      it("creates SpanReceivedEvent with redacted span data", async () => {
        // Mock redactSpan to mutate the span (simulating redaction)
        mockRedactSpan.mockImplementation(
          async (span: {
            attributes: Array<{ key: string; value: { stringValue?: string } }>;
          }) => {
            const attr = span.attributes.find(
              (a) => a.key === "gen_ai.prompt",
            );
            if (attr?.value.stringValue) {
              attr.value.stringValue = "[REDACTED]";
            }
          },
        );

        const command = createMockCommand(
          "project-123",
          "trace-1",
          "span-1",
          [{ key: "gen_ai.prompt", value: { stringValue: "sensitive" } }],
          "STRICT",
        );

        const events = await handler.handle(command);

        expect(events).toHaveLength(1);
        const event = events[0]!;
        expect(event.type).toBe(SPAN_RECEIVED_EVENT_TYPE);
        // The event should contain the redacted span data
        expect(event.data.span.attributes[0]!.value.stringValue).toBe(
          "[REDACTED]",
        );
      });

      it("creates valid SpanReceivedEvent structure", async () => {
        const command = createMockCommand(
          "project-123",
          "trace-abc",
          "span-def",
        );

        const events = await handler.handle(command);

        expect(events).toHaveLength(1);
        const event = events[0]!;
        expect(event.type).toBe(SPAN_RECEIVED_EVENT_TYPE);
        expect(event.aggregateType).toBe("trace");
        expect(event.tenantId).toBe("project-123");
        expect(event.data).toHaveProperty("span");
        expect(event.data).toHaveProperty("resource");
        expect(event.data).toHaveProperty("instrumentationScope");
      });

      it("does not mutate the original command data", async () => {
        mockRedactSpan.mockImplementation(
          async (span: { name: string }) => {
            span.name = "[REDACTED]";
          },
        );

        const command = createMockCommand("project-123", "trace-1", "span-1");
        const originalName = command.data.span.name;

        await handler.handle(command);

        // Original command data should be unchanged
        expect(command.data.span.name).toBe(originalName);
      });
    });
  });
});
