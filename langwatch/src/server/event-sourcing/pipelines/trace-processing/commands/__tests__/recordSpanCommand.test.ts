import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTenantId, type Command } from "../../../../library";
import type { RecordSpanCommandData } from "../../schemas/commands";
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
  mockRedactSpanForTenant: ReturnType<typeof vi.fn>;
} {
  const mockRedactSpanForTenant = vi.fn();

  return {
    deps: {
      piiRedactionService: {
        redactSpanForTenant: mockRedactSpanForTenant,
      },
    },
    mockRedactSpanForTenant,
  };
}

describe("RecordSpanCommand", () => {
  let handler: RecordSpanCommand;
  let mockRedactSpanForTenant: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    const { deps, mockRedactSpanForTenant: mock } = createMockDependencies();
    mockRedactSpanForTenant = mock;
    handler = new RecordSpanCommand(deps);
  });

  describe("handle", () => {
    describe("PII redaction", () => {
      it("calls PII redaction service with tenantId", async () => {
        const tenantId = "project-123";
        const command = createMockCommand(tenantId, "trace-1", "span-1", [
          { key: "gen_ai.prompt", value: { stringValue: "sensitive data" } },
        ]);

        await handler.handle(command);

        expect(mockRedactSpanForTenant).toHaveBeenCalledWith(
          expect.objectContaining({ traceId: "trace-1", spanId: "span-1" }),
          tenantId,
        );
      });

      it("delegates project settings lookup to the service", async () => {
        const command = createMockCommand("project-456", "trace-1", "span-1");

        await handler.handle(command);

        // Service receives tenantId and handles project lookup internally
        expect(mockRedactSpanForTenant).toHaveBeenCalledWith(
          expect.any(Object),
          "project-456",
        );
      });
    });

    describe("event creation", () => {
      it("creates SpanReceivedEvent with redacted span data", async () => {
        // Mock redactSpanForTenant to mutate the span (simulating redaction)
        mockRedactSpanForTenant.mockImplementation(
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
        mockRedactSpanForTenant.mockImplementation(
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
