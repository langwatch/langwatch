import { describe, expect, it, vi } from "vitest";
import {
  decodeScenarioError,
  ScenarioInfraErrorCode,
} from "~/server/scenarios/scenario-infra-error";
import type { FinishRunCommandData } from "../../schemas/commands";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import type { SimulationProcessingEvent } from "../../schemas/events";
import type { SimulationResults } from "../../schemas/shared";
import type { FinishRunDeps } from "../finishRun.command";
import { FinishRunCommand } from "../finishRun.command";

function makeDeps(overrides: Partial<FinishRunDeps> = {}) {
  const loadPriorEvents = vi.fn().mockResolvedValue([]);
  return {
    loadPriorEvents,
    ...overrides,
  } as FinishRunDeps & { loadPriorEvents: typeof loadPriorEvents };
}

function makeCommand(overrides: Partial<FinishRunCommandData> = {}): {
  tenantId: string;
  data: FinishRunCommandData;
} {
  return {
    tenantId: "tenant-1",
    data: {
      tenantId: "tenant-1",
      scenarioRunId: "run-1",
      occurredAt: Date.now(),
      ...overrides,
    },
  };
}

function queuedEvent(): SimulationProcessingEvent {
  return {
    type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
    },
  } as SimulationProcessingEvent;
}

describe("FinishRunCommand", () => {
  describe("when the caller supplies all ECST fields", () => {
    it("emits them without reading prior events", async () => {
      const deps = makeDeps();
      const handler = new FinishRunCommand(deps);

      const events = await handler.handle(
        makeCommand({
          scenarioId: "scenario-1",
          batchRunId: "batch-1",
          scenarioSetId: "set-1",
          traceIds: ["trace-1"],
          status: "SUCCESS",
        }) as any,
      );

      expect(deps.loadPriorEvents).not.toHaveBeenCalled();
      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.type).toBe(SIMULATION_RUN_EVENT_TYPES.FINISHED);
      expect(event.version).toBe(SIMULATION_EVENT_VERSIONS.FINISHED);
      expect(event.idempotencyKey).toBe("tenant-1:run-1:finishRun");
      expect(event.data).toMatchObject({
        scenarioRunId: "run-1",
        scenarioId: "scenario-1",
        batchRunId: "batch-1",
        scenarioSetId: "set-1",
        traceIds: ["trace-1"],
        status: "SUCCESS",
      });
    });
  });

  describe("when ECST fields are missing", () => {
    it("backfills identity from RunQueued and traceIds from prior events", async () => {
      const priorEvents: SimulationProcessingEvent[] = [
        queuedEvent(),
        {
          type: SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
          data: {
            scenarioRunId: "run-1",
            messages: [],
            traceIds: ["trace-1", "trace-2"],
          },
        } as unknown as SimulationProcessingEvent,
        {
          type: SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END,
          data: {
            scenarioRunId: "run-1",
            messageId: "msg-1",
            role: "assistant",
            content: "hi",
            traceId: "trace-2",
          },
        } as unknown as SimulationProcessingEvent,
        {
          type: SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END,
          data: {
            scenarioRunId: "run-1",
            messageId: "msg-2",
            role: "assistant",
            content: "bye",
            traceId: "trace-3",
          },
        } as unknown as SimulationProcessingEvent,
        {
          type: SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
          data: {
            scenarioRunId: "run-1",
            messages: [],
            traceIds: ["trace-1"],
          },
        } as unknown as SimulationProcessingEvent,
      ];
      const deps = makeDeps({
        loadPriorEvents: vi.fn().mockResolvedValue(priorEvents),
      });
      const handler = new FinishRunCommand(deps);

      const events = await handler.handle(makeCommand() as any);

      expect(deps.loadPriorEvents).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        scenarioRunId: "run-1",
      });
      // deduped, first-seen order
      expect(events[0]!.data).toMatchObject({
        scenarioId: "scenario-1",
        batchRunId: "batch-1",
        scenarioSetId: "set-1",
        traceIds: ["trace-1", "trace-2", "trace-3"],
      });
    });

    it("only fills gaps — caller-supplied fields win", async () => {
      const deps = makeDeps({
        loadPriorEvents: vi.fn().mockResolvedValue([queuedEvent()]),
      });
      const handler = new FinishRunCommand(deps);

      const events = await handler.handle(
        makeCommand({
          scenarioId: "caller-scenario",
          traceIds: ["caller-trace"],
        }) as any,
      );

      expect(events[0]!.data).toMatchObject({
        scenarioId: "caller-scenario",
        batchRunId: "batch-1",
        scenarioSetId: "set-1",
        traceIds: ["caller-trace"],
      });
    });

    it("emits without identity when no RunQueued event exists", async () => {
      const deps = makeDeps({ loadPriorEvents: vi.fn().mockResolvedValue([]) });
      const handler = new FinishRunCommand(deps);

      const events = await handler.handle(makeCommand() as any);

      expect(events).toHaveLength(1);
      expect(events[0]!.data).toEqual({
        scenarioRunId: "run-1",
        traceIds: [],
      });
    });
  });

  describe("when constructed without deps (legacy zero-arg registration)", () => {
    it("emits exactly what the caller supplied", async () => {
      const handler = new FinishRunCommand();

      const events = await handler.handle(makeCommand() as any);

      expect(events).toHaveLength(1);
      expect(events[0]!.data).toEqual({ scenarioRunId: "run-1" });
    });
  });

  describe("when an infrastructure caller supplies a bare error", () => {
    /** @scenario "The stall reason is recorded on the terminal event" */
    it("synthesizes failure results so the reason lands on the event", async () => {
      const handler = new FinishRunCommand(makeDeps());

      const events = await handler.handle(
        makeCommand({ status: "ERROR", error: "stalled" }) as any,
      );

      const results = (events[0]!.data as { results?: SimulationResults }).results;
      expect(results).toBeDefined();
      expect(results!.verdict).toBe("failure");
      expect(decodeScenarioError(results!.error)?.code).toBe(
        ScenarioInfraErrorCode.Infra,
      );
    });

    it("keeps the cancelled shape for a CANCELLED status", async () => {
      const handler = new FinishRunCommand(makeDeps());

      const events = await handler.handle(
        makeCommand({ status: "CANCELLED", error: "Cancelled by user" }) as any,
      );

      const results = (events[0]!.data as { results?: SimulationResults }).results;
      expect(results).toBeDefined();
      expect(results!.verdict).toBe("inconclusive");
      expect(results!.error).toBe("Cancelled by user");
    });

    it("prefers caller-supplied results over the bare error", async () => {
      const handler = new FinishRunCommand(makeDeps());
      const supplied = {
        verdict: "failure" as const,
        reasoning: "judge said no",
        metCriteria: [],
        unmetCriteria: [],
        error: "judge failure",
      };

      const events = await handler.handle(
        makeCommand({
          status: "ERROR",
          error: "stalled",
          results: supplied,
        }) as any,
      );

      expect((events[0]!.data as { results?: SimulationResults }).results).toEqual(
        supplied,
      );
    });
  });

  describe("when the caller uses the static routing helpers", () => {
    it("keeps the routing/idempotency contract of the old pure command", () => {
      const payload = makeCommand().data;
      expect(FinishRunCommand.getAggregateId(payload)).toBe("run-1");
      expect(FinishRunCommand.getSpanAttributes(payload)).toEqual({
        "payload.scenarioRun.id": "run-1",
      });
      expect(FinishRunCommand.makeJobId(payload)).toBe("tenant-1:run-1:finish-run");
    });
  });
});
