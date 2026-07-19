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
  mockEstimateSpanTokens: ReturnType<typeof vi.fn>;
} {
  const mockRedactSpan = vi.fn();
  const mockEnrichSpan = vi.fn();
  const mockEstimateSpanTokens = vi.fn();
  const mockDropSpanContent = vi
    .fn()
    .mockResolvedValue({ droppedCount: 0, droppedCategories: [] });

  return {
    deps: {
      piiRedactionService: {
        redactSpan: mockRedactSpan,
      },
      costEnrichmentService: {
        enrichSpan: mockEnrichSpan,
      },
      tokenEstimationService: {
        estimateSpanTokens: mockEstimateSpanTokens,
      },
      contentDropService: {
        dropSpanContent: mockDropSpanContent,
      },
    },
    mockRedactSpan,
    mockEnrichSpan,
    mockEstimateSpanTokens,
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
          expect.any(Object),
          "STRICT",
          "project-123",
        );
      });

      it("defaults to ESSENTIAL when piiRedactionLevel is not provided", async () => {
        const command = createMockCommand("project-456", "trace-1", "span-1");

        await handler.handle(command);

        expect(mockRedactSpan).toHaveBeenCalledWith(
          expect.any(Object),
          expect.anything(),
          "ESSENTIAL",
          "project-456",
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
          expect.anything(),
          "DISABLED",
          "project-789",
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

      /** @scenario Reserved causality_depth attribute passes through strip */
      it("preserves langwatch.reserved.causality_depth on the emitted span (loop-prevention contract)", async () => {
        // Regression for the post-2026-05-11 bug: stripReservedAttributes
        // was nuking the very attribute the evaluationTrigger reactor
        // reads to detect loops, silently disabling loop prevention.
        // The fix is a passthrough allowlist; this test pins the
        // attribute name as load-bearing — renaming or removing the
        // entry would silently re-break loop prevention in production.
        const command = createMockCommand(
          "project-123",
          "trace-1",
          "span-1",
          [
            {
              key: "langwatch.reserved.causality_depth",
              value: { stringValue: "1" },
            },
            {
              key: "langwatch.reserved.pii_redaction_status",
              value: { stringValue: "true" },
            },
            { key: "gen_ai.prompt", value: { stringValue: "hello" } },
          ],
        );

        const events = await handler.handle(command);

        const emittedSpan = events[0]!.data.span;
        const depthAttr = emittedSpan.attributes.find(
          (a) => a.key === "langwatch.reserved.causality_depth",
        );
        expect(depthAttr).toBeDefined();
        expect(depthAttr!.value).toEqual({ stringValue: "1" });

        // Other reserved attrs are still stripped (allowlist is narrow).
        const piiAttr = emittedSpan.attributes.find(
          (a) => a.key === "langwatch.reserved.pii_redaction_status",
        );
        expect(piiAttr).toBeUndefined();
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

    describe("when an attribute value is oversized", () => {
      it("caps a multi-MB base64 image attribute on the emitted span", async () => {
        const bigDataUrl = `data:image/png;base64,${"A".repeat(2 * 1024 * 1024)}`;
        const command = createMockCommand("project-123", "trace-1", "span-1", [
          { key: "langwatch.input", value: { stringValue: bigDataUrl } },
        ]);

        const events = await handler.handle(command);

        const emittedSpan = events[0]!.data.span;
        const inputAttr = emittedSpan.attributes.find(
          (a) => a.key === "langwatch.input",
        );
        expect(inputAttr!.value.stringValue).toMatch(
          /^\[truncated: \d+ bytes, image\/png\]$/,
        );
        // The huge payload must not survive into the folded event.
        expect(inputAttr!.value.stringValue!.length).toBeLessThan(64);
        // Original command data is left untouched (immutability contract).
        expect(command.data.span.attributes[0]!.value.stringValue).toBe(
          bigDataUrl,
        );
      });

      it("leaves a normal small span attribute unchanged", async () => {
        const command = createMockCommand("project-123", "trace-1", "span-1", [
          { key: "langwatch.input", value: { stringValue: "what is 2+2?" } },
        ]);

        const events = await handler.handle(command);

        const emittedSpan = events[0]!.data.span;
        const inputAttr = emittedSpan.attributes.find(
          (a) => a.key === "langwatch.input",
        );
        expect(inputAttr!.value.stringValue).toBe("what is 2+2?");
      });
    });
  });
});
