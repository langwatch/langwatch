import { describe, expect, it } from "vitest";
import type { Command } from "../../../../";
import type { RecordSuiteRunItemStartedCommandData } from "../../schemas/commands";
import {
  SUITE_RUN_COMMAND_TYPES,
  SUITE_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import { RecordSuiteRunItemStartedCommand } from "../recordSuiteRunItemStarted.command";

function makeCommand(
  overrides: Partial<RecordSuiteRunItemStartedCommandData> = {},
): Command<RecordSuiteRunItemStartedCommandData> {
  return {
    tenantId: "tenant-1",
    aggregateId: "batch-123",
    type: SUITE_RUN_COMMAND_TYPES.RECORD_ITEM_STARTED,
    data: {
      tenantId: "tenant-1",
      batchRunId: "batch-123",
      scenarioRunId: "scenario-run-1",
      scenarioId: "scenario-1",
      occurredAt: 1700000000000,
      ...overrides,
    },
  } as Command<RecordSuiteRunItemStartedCommandData>;
}

describe("RecordSuiteRunItemStartedCommand", () => {
  describe("handle()", () => {
    describe("when invoked with valid command data", () => {
      it("emits a single SuiteRunItemStartedEvent", async () => {
        const handler = new RecordSuiteRunItemStartedCommand();
        const events = await handler.handle(makeCommand());

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe(SUITE_RUN_EVENT_TYPES.ITEM_STARTED);
      });

      it("sets correct aggregate fields on the event", async () => {
        const handler = new RecordSuiteRunItemStartedCommand();
        const events = await handler.handle(makeCommand());

        const event = events[0]!;
        expect(event.aggregateType).toBe("suite_run");
        expect(event.aggregateId).toBe("batch-123");
      });

      it("maps command data to event data", async () => {
        const handler = new RecordSuiteRunItemStartedCommand();
        const events = await handler.handle(makeCommand());

        expect(events[0]!.data).toEqual({
          batchRunId: "batch-123",
          scenarioRunId: "scenario-run-1",
          scenarioId: "scenario-1",
        });
      });

      it("uses the command occurredAt for the event", async () => {
        const handler = new RecordSuiteRunItemStartedCommand();
        const events = await handler.handle(
          makeCommand({ occurredAt: 1700000099999 }),
        );

        expect(events[0]!.occurredAt).toBe(1700000099999);
      });
    });
  });

  describe("getAggregateId()", () => {
    it("returns the batchRunId", () => {
      const payload = makeCommand().data;
      expect(RecordSuiteRunItemStartedCommand.getAggregateId(payload)).toBe(
        "batch-123",
      );
    });
  });

  describe("makeJobId()", () => {
    it("returns tenantId:batchRunId:scenarioRunId:itemStarted", () => {
      const payload = makeCommand().data;
      expect(RecordSuiteRunItemStartedCommand.makeJobId(payload)).toBe(
        "tenant-1:batch-123:scenario-run-1:itemStarted",
      );
    });
  });

  describe("getSpanAttributes()", () => {
    it("returns batchRun.id and scenarioRun.id", () => {
      const payload = makeCommand().data;
      expect(
        RecordSuiteRunItemStartedCommand.getSpanAttributes(payload),
      ).toEqual({
        "payload.batchRun.id": "batch-123",
        "payload.scenarioRun.id": "scenario-run-1",
      });
    });
  });

  describe("schema", () => {
    it("has correct command type", () => {
      expect(RecordSuiteRunItemStartedCommand.schema.type).toBe(
        SUITE_RUN_COMMAND_TYPES.RECORD_ITEM_STARTED,
      );
    });
  });
});
