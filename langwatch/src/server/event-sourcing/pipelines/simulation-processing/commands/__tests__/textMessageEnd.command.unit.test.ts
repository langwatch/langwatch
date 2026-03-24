import { describe, expect, it } from "vitest";
import type { Command } from "../../../../";
import type { TextMessageEndCommandData } from "../../schemas/commands";
import {
  SIMULATION_RUN_COMMAND_TYPES,
  SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import { TextMessageEndCommand } from "../textMessageEnd.command";

function makeCommand(
  overrides: Partial<TextMessageEndCommandData> = {},
): Command<TextMessageEndCommandData> {
  return {
    tenantId: "tenant-1",
    aggregateId: "run-123",
    type: SIMULATION_RUN_COMMAND_TYPES.TEXT_MESSAGE_END,
    data: {
      tenantId: "tenant-1",
      scenarioRunId: "run-123",
      messageId: "msg-1",
      role: "assistant",
      content: "Hello world",
      occurredAt: 1700000000000,
      ...overrides,
    },
  } as Command<TextMessageEndCommandData>;
}

describe("TextMessageEndCommand", () => {
  describe("handle()", () => {
    describe("when invoked with valid command data", () => {
      it("emits a single text message end event", async () => {
        const handler = new TextMessageEndCommand();
        const events = await handler.handle(makeCommand());

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END);
      });

      it("maps command data to event data including optional fields", async () => {
        const handler = new TextMessageEndCommand();
        const events = await handler.handle(
          makeCommand({
            message: { custom: "data" },
            traceId: "trace-1",
            messageIndex: 3,
          }),
        );

        expect(events[0]!.data).toMatchObject({
          scenarioRunId: "run-123",
          messageId: "msg-1",
          role: "assistant",
          content: "Hello world",
          message: { custom: "data" },
          traceId: "trace-1",
          messageIndex: 3,
        });
      });

      it("sets correct aggregate fields", async () => {
        const handler = new TextMessageEndCommand();
        const events = await handler.handle(makeCommand());

        expect(events[0]!.aggregateType).toBe("simulation_run");
        expect(events[0]!.aggregateId).toBe("run-123");
      });
    });
  });

  describe("getAggregateId()", () => {
    it("returns the scenarioRunId", () => {
      expect(TextMessageEndCommand.getAggregateId(makeCommand().data)).toBe("run-123");
    });
  });

  describe("getSpanAttributes()", () => {
    it("returns scenarioRun id, message id, role, and content length", () => {
      expect(TextMessageEndCommand.getSpanAttributes(makeCommand().data)).toEqual({
        "payload.scenarioRun.id": "run-123",
        "payload.message.id": "msg-1",
        "payload.message.role": "assistant",
        "payload.message.contentLength": 11,
      });
    });
  });

  describe("makeJobId()", () => {
    it("returns tenantId:scenarioRunId:text-message-end:messageId", () => {
      expect(TextMessageEndCommand.makeJobId(makeCommand().data)).toBe(
        "tenant-1:run-123:text-message-end:msg-1",
      );
    });
  });

  describe("schema", () => {
    it("has correct command type", () => {
      expect(TextMessageEndCommand.schema.type).toBe(
        SIMULATION_RUN_COMMAND_TYPES.TEXT_MESSAGE_END,
      );
    });
  });
});
