import { describe, expect, it } from "vitest";
import type { Command } from "../../../../";
import type { QueueRunCommandData } from "../../schemas/commands";
import {
  SIMULATION_RUN_COMMAND_TYPES,
  SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import { QueueRunCommand } from "../queueRun.command";

function makeCommand(
  overrides: Partial<QueueRunCommandData> = {},
): Command<QueueRunCommandData> {
  return {
    tenantId: "tenant-1",
    aggregateId: "run-123",
    type: SIMULATION_RUN_COMMAND_TYPES.QUEUE,
    data: {
      tenantId: "tenant-1",
      scenarioRunId: "run-123",
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
      occurredAt: 1700000000000,
      ...overrides,
    },
  } as Command<QueueRunCommandData>;
}

describe("QueueRunCommand", () => {
  describe("handle()", () => {
    describe("when invoked with valid command data", () => {
      it("emits a single simulation run queued event", async () => {
        const handler = new QueueRunCommand();
        const events = await handler.handle(makeCommand());

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe(SIMULATION_RUN_EVENT_TYPES.QUEUED);
      });

      it("maps command data to event data without tenantId and occurredAt", async () => {
        const handler = new QueueRunCommand();
        const events = await handler.handle(
          makeCommand({ name: "test", description: "desc", metadata: { k: "v" } }),
        );

        expect(events[0]!.data).toMatchObject({
          scenarioRunId: "run-123",
          scenarioId: "scenario-1",
          batchRunId: "batch-1",
          scenarioSetId: "set-1",
          name: "test",
          description: "desc",
          metadata: { k: "v" },
        });
      });

      it("sets correct aggregate fields", async () => {
        const handler = new QueueRunCommand();
        const events = await handler.handle(makeCommand());

        expect(events[0]!.aggregateType).toBe("simulation_run");
        expect(events[0]!.aggregateId).toBe("run-123");
      });
    });
  });

  describe("getAggregateId()", () => {
    it("returns the scenarioRunId", () => {
      expect(QueueRunCommand.getAggregateId(makeCommand().data)).toBe("run-123");
    });
  });

  describe("getSpanAttributes()", () => {
    it("returns scenarioRun, scenario, and batchRun ids", () => {
      expect(QueueRunCommand.getSpanAttributes(makeCommand().data)).toEqual({
        "payload.scenarioRun.id": "run-123",
        "payload.scenario.id": "scenario-1",
        "payload.batchRun.id": "batch-1",
      });
    });
  });

  describe("makeJobId()", () => {
    it("returns tenantId:scenarioRunId:queue-run", () => {
      expect(QueueRunCommand.makeJobId(makeCommand().data)).toBe(
        "tenant-1:run-123:queue-run",
      );
    });
  });

  describe("schema", () => {
    it("has correct command type", () => {
      expect(QueueRunCommand.schema.type).toBe(SIMULATION_RUN_COMMAND_TYPES.QUEUE);
    });
  });
});
