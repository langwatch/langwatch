import { describe, expect, it } from "vitest";
import type { Command } from "../../../../";
import type { StartSuiteRunCommandData } from "../../schemas/commands";
import {
  SUITE_RUN_COMMAND_TYPES,
  SUITE_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import { StartSuiteRunCommand } from "../startSuiteRun.command";

function makeCommand(
  overrides: Partial<StartSuiteRunCommandData> = {},
): Command<StartSuiteRunCommandData> {
  return {
    tenantId: "tenant-1",
    aggregateId: "batch-123",
    type: SUITE_RUN_COMMAND_TYPES.START,
    data: {
      tenantId: "tenant-1",
      batchRunId: "batch-123",
      scenarioSetId: "scenario-set-1",
      suiteId: "suite-1",
      total: 5,
      scenarioIds: ["s1", "s2"],
      targetIds: ["t1", "t2"],
      idempotencyKey: "idem-abc",
      occurredAt: 1700000000000,
      ...overrides,
    },
  } as Command<StartSuiteRunCommandData>;
}

describe("StartSuiteRunCommand", () => {
  describe("handle()", () => {
    describe("when invoked with valid command data", () => {
      it("emits a single SuiteRunStartedEvent", async () => {
        const handler = new StartSuiteRunCommand();
        const events = await handler.handle(makeCommand());

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe(SUITE_RUN_EVENT_TYPES.STARTED);
      });

      it("sets correct aggregate fields on the event", async () => {
        const handler = new StartSuiteRunCommand();
        const events = await handler.handle(makeCommand());

        const event = events[0]!;
        expect(event.aggregateType).toBe("suite_run");
        expect(event.aggregateId).toBe("batch-123");
      });

      it("maps command data to event data", async () => {
        const handler = new StartSuiteRunCommand();
        const events = await handler.handle(makeCommand());

        expect(events[0]!.data).toEqual({
          batchRunId: "batch-123",
          scenarioSetId: "scenario-set-1",
          suiteId: "suite-1",
          total: 5,
          scenarioIds: ["s1", "s2"],
          targetIds: ["t1", "t2"],
        });
      });

      it("uses the command occurredAt for the event", async () => {
        const handler = new StartSuiteRunCommand();
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
      expect(StartSuiteRunCommand.getAggregateId(payload)).toBe("batch-123");
    });
  });

  describe("makeJobId()", () => {
    it("returns tenantId:batchRunId:idempotencyKey", () => {
      const payload = makeCommand().data;
      expect(StartSuiteRunCommand.makeJobId(payload)).toBe(
        "tenant-1:batch-123:idem-abc",
      );
    });
  });

  describe("getSpanAttributes()", () => {
    it("returns batchRun.id, suite.id, and total", () => {
      const payload = makeCommand().data;
      expect(StartSuiteRunCommand.getSpanAttributes(payload)).toEqual({
        "payload.batchRun.id": "batch-123",
        "payload.suite.id": "suite-1",
        "payload.total": 5,
      });
    });
  });

  describe("schema", () => {
    it("has correct command type", () => {
      expect(StartSuiteRunCommand.schema.type).toBe(
        SUITE_RUN_COMMAND_TYPES.START,
      );
    });
  });
});
