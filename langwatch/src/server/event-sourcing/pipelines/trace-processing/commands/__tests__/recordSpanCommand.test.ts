import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantId, type Command } from "../../../../";
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
      occurredAt: 1000000,
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
  mockEnrichSpan: ReturnType<typeof vi.fn>;
} {
  const mockRedactSpan = vi.fn();
  const mockEnrichSpan = vi.fn();

  return {
    deps: {
      piiRedactionService: {
        redactSpan: mockRedactSpan,
      },
      costEnrichmentService: {
        enrichSpan: mockEnrichSpan,
      },
    },
    mockRedactSpan,
    mockEnrichSpan,
  };
}

describe("RecordSpanCommand", () => {
  let handler: RecordSpanCommand;
  let mockRedactSpan: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    const { deps, mockRedactSpan: mock } = createMockDependencies();
    mockRedactSpan = mock;
    // mockEnrichSpan is available via deps but not needed in most tests
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

    describe("when pre-processing steps fail", () => {
      it("throws when PII redaction rejects", async () => {
        const { deps, mockRedactSpan } = createMockDependencies();
        mockRedactSpan.mockRejectedValue(new Error("PII service unavailable"));
        const cmd = new RecordSpanCommand(deps);

        const command = createMockCommand("project-123", "trace-1", "span-1");

        await expect(cmd.handle(command)).rejects.toThrow(
          "PII service unavailable",
        );
      });

      it("returns events normally when cost enrichment rejects", async () => {
        const { deps, mockEnrichSpan } = createMockDependencies();
        mockEnrichSpan.mockRejectedValue(new Error("Cost API timeout"));
        const cmd = new RecordSpanCommand(deps);

        const command = createMockCommand("project-123", "trace-1", "span-1");

        const events = await cmd.handle(command);

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe(SPAN_RECEIVED_EVENT_TYPE);
      });

      it("throws the PII error when both reject", async () => {
        const { deps, mockRedactSpan, mockEnrichSpan } =
          createMockDependencies();
        mockRedactSpan.mockRejectedValue(new Error("PII failure"));
        mockEnrichSpan.mockRejectedValue(new Error("Cost failure"));
        const cmd = new RecordSpanCommand(deps);

        const command = createMockCommand("project-123", "trace-1", "span-1");

        await expect(cmd.handle(command)).rejects.toThrow("PII failure");
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

    describe("when reserved attributes are present", () => {
      it("strips langwatch.reserved.* attributes from span before processing", async () => {
        const command = createMockCommand(
          "project-123",
          "trace-1",
          "span-1",
          [
            {
              key: "langwatch.reserved.pii_redaction_status",
              value: { stringValue: "true" },
            },
            { key: "gen_ai.prompt", value: { stringValue: "hello" } },
          ],
        );

        const events = await handler.handle(command);

        const emittedSpan = events[0]!.data.span;
        const reservedAttr = emittedSpan.attributes.find(
          (a) => a.key === "langwatch.reserved.pii_redaction_status",
        );
        expect(reservedAttr).toBeUndefined();
        // Non-reserved attributes should remain
        const promptAttr = emittedSpan.attributes.find(
          (a) => a.key === "gen_ai.prompt",
        );
        expect(promptAttr).toBeDefined();
      });

      it("strips langwatch.reserved.* attributes from events", async () => {
        const command = createMockCommand(
          "project-123",
          "trace-1",
          "span-1",
        );
        command.data.span.events = [
          {
            timeUnixNano: { low: 0, high: 0 },
            name: "test-event",
            attributes: [
              {
                key: "langwatch.reserved.foo",
                value: { stringValue: "bar" },
              },
            ],
            droppedAttributesCount: 0,
          },
        ];

        const events = await handler.handle(command);

        const emittedSpan = events[0]!.data.span;
        expect(emittedSpan.events[0]!.attributes).toHaveLength(0);
      });

      it("preserves original command data when stripping reserved attributes", async () => {
        const command = createMockCommand(
          "project-123",
          "trace-1",
          "span-1",
          [
            {
              key: "langwatch.reserved.something",
              value: { stringValue: "value" },
            },
          ],
        );

        await handler.handle(command);

        // Original command should still have the reserved attribute
        expect(command.data.span.attributes).toHaveLength(1);
        expect(command.data.span.attributes[0]!.key).toBe(
          "langwatch.reserved.something",
        );
      });
    });
  });
});
