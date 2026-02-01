import type { PIIRedactionLevel } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantId, type Command } from "../../../../library";
import type { RecordSpanCommandData } from "../../schemas/commands";
import {
  RECORD_SPAN_COMMAND_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "../../schemas/constants";
import type { OtlpSpan } from "../../schemas/otlp";
import {
  RecordSpanCommand,
  type RecordSpanCommandDependencies,
} from "../recordSpanCommand";

function createMockCommand(
  tenantId: string,
  traceId: string,
  spanId: string,
  attributes: Array<{ key: string; value: { stringValue?: string } }> = [],
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
    },
  };
}

function createMockDependencies(): {
  deps: RecordSpanCommandDependencies;
  mockFindUnique: ReturnType<typeof vi.fn>;
  mockRedactSpan: ReturnType<typeof vi.fn>;
} {
  const mockFindUnique = vi.fn();
  const mockRedactSpan = vi.fn();

  return {
    deps: {
      prisma: {
        project: {
          findUnique: mockFindUnique,
        },
      } as unknown as RecordSpanCommandDependencies["prisma"],
      piiRedactionService: {
        redactSpan: mockRedactSpan,
      },
    },
    mockFindUnique,
    mockRedactSpan,
  };
}

describe("RecordSpanCommand", () => {
  let handler: RecordSpanCommand;
  let mockFindUnique: ReturnType<typeof vi.fn>;
  let mockRedactSpan: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    const { deps, mockFindUnique: mfu, mockRedactSpan: mrs } =
      createMockDependencies();
    mockFindUnique = mfu;
    mockRedactSpan = mrs;
    handler = new RecordSpanCommand(deps);
  });

  describe("handle", () => {
    describe("PII redaction", () => {
      it("fetches project piiRedactionLevel from database", async () => {
        const tenantId = "project-123";
        mockFindUnique.mockResolvedValue({ piiRedactionLevel: "STRICT" });
        const command = createMockCommand(tenantId, "trace-1", "span-1");

        await handler.handle(command);

        expect(mockFindUnique).toHaveBeenCalledWith({
          where: { id: tenantId },
          select: { piiRedactionLevel: true },
        });
      });

      it("calls PII redaction service when level is STRICT", async () => {
        mockFindUnique.mockResolvedValue({ piiRedactionLevel: "STRICT" });
        const command = createMockCommand("project-123", "trace-1", "span-1", [
          { key: "gen_ai.prompt", value: { stringValue: "sensitive data" } },
        ]);

        await handler.handle(command);

        expect(mockRedactSpan).toHaveBeenCalledWith(
          command.data.span,
          "STRICT",
        );
      });

      it("calls PII redaction service when level is ESSENTIAL", async () => {
        mockFindUnique.mockResolvedValue({ piiRedactionLevel: "ESSENTIAL" });
        const command = createMockCommand("project-123", "trace-1", "span-1");

        await handler.handle(command);

        expect(mockRedactSpan).toHaveBeenCalledWith(
          command.data.span,
          "ESSENTIAL",
        );
      });

      it("calls PII redaction service with DISABLED level (service handles skip)", async () => {
        mockFindUnique.mockResolvedValue({ piiRedactionLevel: "DISABLED" });
        const command = createMockCommand("project-123", "trace-1", "span-1");

        await handler.handle(command);

        // The command always calls redactSpan; the service handles the DISABLED check
        expect(mockRedactSpan).toHaveBeenCalledWith(
          command.data.span,
          "DISABLED",
        );
      });

      it("defaults to ESSENTIAL when project is not found", async () => {
        mockFindUnique.mockResolvedValue(null);
        const command = createMockCommand("project-123", "trace-1", "span-1");

        await handler.handle(command);

        expect(mockRedactSpan).toHaveBeenCalledWith(
          command.data.span,
          "ESSENTIAL",
        );
      });
    });

    describe("event creation", () => {
      it("creates SpanReceivedEvent with redacted span data", async () => {
        mockFindUnique.mockResolvedValue({ piiRedactionLevel: "STRICT" });
        // Mock redactSpan to mutate the span (simulating redaction)
        mockRedactSpan.mockImplementation(
          async (
            span: {
              attributes: Array<{ key: string; value: { stringValue?: string } }>;
            },
            _level: PIIRedactionLevel,
          ) => {
            const attr = span.attributes.find(
              (a) => a.key === "gen_ai.prompt",
            );
            if (attr?.value.stringValue) {
              attr.value.stringValue = "[REDACTED]";
            }
          },
        );

        const command = createMockCommand("project-123", "trace-1", "span-1", [
          { key: "gen_ai.prompt", value: { stringValue: "sensitive" } },
        ]);

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
        mockFindUnique.mockResolvedValue({ piiRedactionLevel: "DISABLED" });
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
    });
  });
});
