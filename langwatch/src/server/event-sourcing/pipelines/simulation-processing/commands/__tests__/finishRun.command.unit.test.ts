import { describe, expect, it } from "vitest";
import type { Command } from "../../../../";
import type { FinishRunCommandData } from "../../schemas/commands";
import {
  SIMULATION_RUN_COMMAND_TYPES,
  SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import { FinishRunCommand } from "../finishRun.command";

function makeCommand(
  overrides: Partial<FinishRunCommandData> = {},
): Command<FinishRunCommandData> {
  return {
    tenantId: "tenant-1",
    aggregateId: "run-123",
    type: SIMULATION_RUN_COMMAND_TYPES.FINISH,
    data: {
      tenantId: "tenant-1",
      scenarioRunId: "run-123",
      occurredAt: 1700000000000,
      ...overrides,
    },
  } as Command<FinishRunCommandData>;
}

describe("FinishRunCommand", () => {
  describe("handle()", () => {
    describe("when invoked with valid command data", () => {
      it("emits a single simulation run finished event", async () => {
        const handler = new FinishRunCommand();
        const events = await handler.handle(makeCommand());

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe(SIMULATION_RUN_EVENT_TYPES.FINISHED);
      });

      it("maps command data to event data including optional fields", async () => {
        const handler = new FinishRunCommand();
        const events = await handler.handle(
          makeCommand({ durationMs: 5000, status: "completed" }),
        );

        expect(events[0]!.data).toMatchObject({
          scenarioRunId: "run-123",
          durationMs: 5000,
          status: "completed",
        });
      });

      it("sets correct aggregate fields", async () => {
        const handler = new FinishRunCommand();
        const events = await handler.handle(makeCommand());

        expect(events[0]!.aggregateType).toBe("simulation_run");
        expect(events[0]!.aggregateId).toBe("run-123");
      });
    });
  });

  describe("getAggregateId()", () => {
    it("returns the scenarioRunId", () => {
      expect(FinishRunCommand.getAggregateId(makeCommand().data)).toBe("run-123");
    });
  });

  describe("getSpanAttributes()", () => {
    it("returns scenarioRun id, hasResults, and durationMs", () => {
      expect(
        FinishRunCommand.getSpanAttributes(
          makeCommand({ durationMs: 1234 }).data,
        ),
      ).toEqual({
        "payload.scenarioRun.id": "run-123",
        "payload.hasResults": false,
        "payload.durationMs": 1234,
      });
    });

    it("defaults durationMs to 0 when undefined", () => {
      expect(FinishRunCommand.getSpanAttributes(makeCommand().data)).toEqual({
        "payload.scenarioRun.id": "run-123",
        "payload.hasResults": false,
        "payload.durationMs": 0,
      });
    });
  });

  describe("makeJobId()", () => {
    it("returns tenantId:scenarioRunId:finish-run", () => {
      expect(FinishRunCommand.makeJobId(makeCommand().data)).toBe(
        "tenant-1:run-123:finish-run",
      );
    });
  });

  describe("schema", () => {
    it("has correct command type", () => {
      expect(FinishRunCommand.schema.type).toBe(SIMULATION_RUN_COMMAND_TYPES.FINISH);
    });
  });
});
