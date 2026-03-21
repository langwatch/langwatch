import { describe, expect, it } from "vitest";
import type { Command } from "../../../../";
import type { TextMessageStartCommandData } from "../../schemas/commands";
import {
  SIMULATION_RUN_COMMAND_TYPES,
  SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import { TextMessageStartCommand } from "../textMessageStart.command";

function makeCommand(
  overrides: Partial<TextMessageStartCommandData> = {},
): Command<TextMessageStartCommandData> {
  return {
    tenantId: "tenant-1",
    aggregateId: "run-123",
    type: SIMULATION_RUN_COMMAND_TYPES.TEXT_MESSAGE_START,
    data: {
      tenantId: "tenant-1",
      scenarioRunId: "run-123",
      messageId: "msg-1",
      role: "assistant",
      occurredAt: 1700000000000,
      ...overrides,
    },
  } as Command<TextMessageStartCommandData>;
}

describe("TextMessageStartCommand", () => {
  describe("handle()", () => {
    describe("when invoked with valid command data", () => {
      it("emits a single text message start event", async () => {
        const handler = new TextMessageStartCommand();
        const events = await handler.handle(makeCommand());

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_START);
      });

      it("maps command data to event data", async () => {
        const handler = new TextMessageStartCommand();
        const events = await handler.handle(makeCommand({ messageIndex: 2 }));

        expect(events[0]!.data).toMatchObject({
          scenarioRunId: "run-123",
          messageId: "msg-1",
          role: "assistant",
          messageIndex: 2,
        });
      });

      it("sets correct aggregate fields", async () => {
        const handler = new TextMessageStartCommand();
        const events = await handler.handle(makeCommand());

        expect(events[0]!.aggregateType).toBe("simulation_run");
        expect(events[0]!.aggregateId).toBe("run-123");
      });
    });
  });

  describe("getAggregateId()", () => {
    it("returns the scenarioRunId", () => {
      expect(TextMessageStartCommand.getAggregateId(makeCommand().data)).toBe("run-123");
    });
  });

  describe("getSpanAttributes()", () => {
    it("returns scenarioRun id, message id, and role", () => {
      expect(TextMessageStartCommand.getSpanAttributes(makeCommand().data)).toEqual({
        "payload.scenarioRun.id": "run-123",
        "payload.message.id": "msg-1",
        "payload.message.role": "assistant",
      });
    });
  });

  describe("makeJobId()", () => {
    it("returns tenantId:scenarioRunId:text-message-start:messageId", () => {
      expect(TextMessageStartCommand.makeJobId(makeCommand().data)).toBe(
        "tenant-1:run-123:text-message-start:msg-1",
      );
    });
  });

  describe("schema", () => {
    it("has correct command type", () => {
      expect(TextMessageStartCommand.schema.type).toBe(
        SIMULATION_RUN_COMMAND_TYPES.TEXT_MESSAGE_START,
      );
    });
  });
});
