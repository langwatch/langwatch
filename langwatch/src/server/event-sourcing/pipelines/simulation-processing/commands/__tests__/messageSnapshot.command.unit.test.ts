import { describe, expect, it } from "vitest";
import type { Command } from "../../../../";
import type { MessageSnapshotCommandData } from "../../schemas/commands";
import {
  SIMULATION_RUN_COMMAND_TYPES,
  SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import { MessageSnapshotCommand } from "../messageSnapshot.command";

function makeCommand(
  overrides: Partial<MessageSnapshotCommandData> = {},
): Command<MessageSnapshotCommandData> {
  return {
    tenantId: "tenant-1",
    aggregateId: "run-123",
    type: SIMULATION_RUN_COMMAND_TYPES.MESSAGE_SNAPSHOT,
    data: {
      tenantId: "tenant-1",
      scenarioRunId: "run-123",
      messages: [{ role: "user", content: "hi" }],
      traceIds: ["trace-1"],
      occurredAt: 1700000000000,
      ...overrides,
    },
  } as Command<MessageSnapshotCommandData>;
}

describe("MessageSnapshotCommand", () => {
  describe("handle()", () => {
    describe("when invoked with valid command data", () => {
      it("emits a single message snapshot event", async () => {
        const handler = new MessageSnapshotCommand();
        const events = await handler.handle(makeCommand());

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe(SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT);
      });

      it("maps command data to event data", async () => {
        const handler = new MessageSnapshotCommand();
        const events = await handler.handle(makeCommand({ status: "running" }));

        expect(events[0]!.data).toMatchObject({
          scenarioRunId: "run-123",
          messages: [{ role: "user", content: "hi" }],
          traceIds: ["trace-1"],
          status: "running",
        });
      });

      it("sets correct aggregate fields", async () => {
        const handler = new MessageSnapshotCommand();
        const events = await handler.handle(makeCommand());

        expect(events[0]!.aggregateType).toBe("simulation_run");
        expect(events[0]!.aggregateId).toBe("run-123");
      });
    });
  });

  describe("getAggregateId()", () => {
    it("returns the scenarioRunId", () => {
      expect(MessageSnapshotCommand.getAggregateId(makeCommand().data)).toBe("run-123");
    });
  });

  describe("getSpanAttributes()", () => {
    it("returns scenarioRun id and message count", () => {
      expect(MessageSnapshotCommand.getSpanAttributes(makeCommand().data)).toEqual({
        "payload.scenarioRun.id": "run-123",
        "payload.message.count": 1,
      });
    });
  });

  describe("makeJobId()", () => {
    it("returns tenantId:scenarioRunId:message-snapshot", () => {
      expect(MessageSnapshotCommand.makeJobId(makeCommand().data)).toBe(
        "tenant-1:run-123:message-snapshot",
      );
    });
  });

  describe("schema", () => {
    it("has correct command type", () => {
      expect(MessageSnapshotCommand.schema.type).toBe(
        SIMULATION_RUN_COMMAND_TYPES.MESSAGE_SNAPSHOT,
      );
    });
  });
});
