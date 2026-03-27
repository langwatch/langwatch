import { describe, expect, it } from "vitest";
import type { Command } from "../../../../";
import type { CompleteSuiteRunItemCommandData } from "../../schemas/commands";
import {
  SUITE_RUN_COMMAND_TYPES,
  SUITE_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import { CompleteSuiteRunItemCommand } from "../completeSuiteRunItem.command";

function makeCommand(
  overrides: Partial<CompleteSuiteRunItemCommandData> = {},
): Command<CompleteSuiteRunItemCommandData> {
  return {
    tenantId: "tenant-1",
    aggregateId: "batch-123",
    type: SUITE_RUN_COMMAND_TYPES.COMPLETE_ITEM,
    data: {
      tenantId: "tenant-1",
      batchRunId: "batch-123",
      scenarioRunId: "scenario-run-1",
      scenarioId: "scenario-1",
      status: "processed",
      verdict: "passed",
      durationMs: 1500,
      reasoning: "All checks passed",
      error: undefined,
      occurredAt: 1700000000000,
      ...overrides,
    },
  } as Command<CompleteSuiteRunItemCommandData>;
}

describe("CompleteSuiteRunItemCommand", () => {
  describe("handle()", () => {
    describe("when invoked with valid command data", () => {
      it("emits a single SuiteRunItemCompletedEvent", async () => {
        const handler = new CompleteSuiteRunItemCommand();
        const events = await handler.handle(makeCommand());

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe(SUITE_RUN_EVENT_TYPES.ITEM_COMPLETED);
      });

      it("sets correct aggregate fields on the event", async () => {
        const handler = new CompleteSuiteRunItemCommand();
        const events = await handler.handle(makeCommand());

        const event = events[0]!;
        expect(event.aggregateType).toBe("suite_run");
        expect(event.aggregateId).toBe("batch-123");
      });

      it("maps command data to event data", async () => {
        const handler = new CompleteSuiteRunItemCommand();
        const events = await handler.handle(makeCommand());

        expect(events[0]!.data).toEqual({
          batchRunId: "batch-123",
          scenarioRunId: "scenario-run-1",
          scenarioId: "scenario-1",
          status: "processed",
          verdict: "passed",
          durationMs: 1500,
          reasoning: "All checks passed",
          error: undefined,
        });
      });

      it("uses the command occurredAt for the event", async () => {
        const handler = new CompleteSuiteRunItemCommand();
        const events = await handler.handle(
          makeCommand({ occurredAt: 1700000099999 }),
        );

        expect(events[0]!.occurredAt).toBe(1700000099999);
      });
    });

    describe("when optional fields are omitted", () => {
      it("includes undefined optional fields in event data", async () => {
        const handler = new CompleteSuiteRunItemCommand();
        const events = await handler.handle(
          makeCommand({
            verdict: undefined,
            durationMs: undefined,
            reasoning: undefined,
            error: undefined,
          }),
        );

        const event = events[0]!;
        expect(event.data).toMatchObject({
          batchRunId: "batch-123",
          scenarioRunId: "scenario-run-1",
          scenarioId: "scenario-1",
          status: "processed",
        });
        expect(event.data).toHaveProperty("verdict", undefined);
        expect(event.data).toHaveProperty("durationMs", undefined);
        expect(event.data).toHaveProperty("reasoning", undefined);
        expect(event.data).toHaveProperty("error", undefined);
      });
    });
  });

  describe("getAggregateId()", () => {
    it("returns the batchRunId", () => {
      const payload = makeCommand().data;
      expect(CompleteSuiteRunItemCommand.getAggregateId(payload)).toBe(
        "batch-123",
      );
    });
  });

  describe("makeJobId()", () => {
    it("returns tenantId:batchRunId:scenarioRunId:itemCompleted", () => {
      const payload = makeCommand().data;
      expect(CompleteSuiteRunItemCommand.makeJobId(payload)).toBe(
        "tenant-1:batch-123:scenario-run-1:itemCompleted",
      );
    });
  });

  describe("getSpanAttributes()", () => {
    it("returns batchRun.id, scenarioRun.id, and status", () => {
      const payload = makeCommand().data;
      expect(CompleteSuiteRunItemCommand.getSpanAttributes(payload)).toEqual({
        "payload.batchRun.id": "batch-123",
        "payload.scenarioRun.id": "scenario-run-1",
        "payload.status": "processed",
      });
    });
  });

  describe("schema", () => {
    it("has correct command type", () => {
      expect(CompleteSuiteRunItemCommand.schema.type).toBe(
        SUITE_RUN_COMMAND_TYPES.COMPLETE_ITEM,
      );
    });
  });
});
