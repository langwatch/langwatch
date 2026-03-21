import { describe, expect, it } from "vitest";
import type { Command } from "../../../../";
import type { DeleteRunCommandData } from "../../schemas/commands";
import {
  SIMULATION_RUN_COMMAND_TYPES,
  SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import { DeleteRunCommand } from "../deleteRun.command";

function makeCommand(
  overrides: Partial<DeleteRunCommandData> = {},
): Command<DeleteRunCommandData> {
  return {
    tenantId: "tenant-1",
    aggregateId: "run-123",
    type: SIMULATION_RUN_COMMAND_TYPES.DELETE,
    data: {
      tenantId: "tenant-1",
      scenarioRunId: "run-123",
      occurredAt: 1700000000000,
      ...overrides,
    },
  } as Command<DeleteRunCommandData>;
}

describe("DeleteRunCommand", () => {
  describe("handle()", () => {
    describe("when invoked with valid command data", () => {
      it("emits a single simulation run deleted event", async () => {
        const handler = new DeleteRunCommand();
        const events = await handler.handle(makeCommand());

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe(SIMULATION_RUN_EVENT_TYPES.DELETED);
      });

      it("maps command data to event data with only scenarioRunId", async () => {
        const handler = new DeleteRunCommand();
        const events = await handler.handle(makeCommand());

        expect(events[0]!.data).toMatchObject({
          scenarioRunId: "run-123",
        });
      });

      it("sets correct aggregate fields", async () => {
        const handler = new DeleteRunCommand();
        const events = await handler.handle(makeCommand());

        expect(events[0]!.aggregateType).toBe("simulation_run");
        expect(events[0]!.aggregateId).toBe("run-123");
      });
    });
  });

  describe("getAggregateId()", () => {
    it("returns the scenarioRunId", () => {
      expect(DeleteRunCommand.getAggregateId(makeCommand().data)).toBe("run-123");
    });
  });

  describe("getSpanAttributes()", () => {
    it("returns only scenarioRun id", () => {
      expect(DeleteRunCommand.getSpanAttributes(makeCommand().data)).toEqual({
        "payload.scenarioRun.id": "run-123",
      });
    });
  });

  describe("makeJobId()", () => {
    it("returns tenantId:scenarioRunId:delete-run", () => {
      expect(DeleteRunCommand.makeJobId(makeCommand().data)).toBe(
        "tenant-1:run-123:delete-run",
      );
    });
  });

  describe("schema", () => {
    it("has correct command type", () => {
      expect(DeleteRunCommand.schema.type).toBe(SIMULATION_RUN_COMMAND_TYPES.DELETE);
    });
  });
});
