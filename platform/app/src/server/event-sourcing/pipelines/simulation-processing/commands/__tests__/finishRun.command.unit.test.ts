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

      const results = (events[0]!.data as { results?: SimulationResults })
        .results;
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

      const results = (events[0]!.data as { results?: SimulationResults })
        .results;
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

      expect(
        (events[0]!.data as { results?: SimulationResults }).results,
      ).toEqual(supplied);
    });
  });

  describe("when caller-supplied results carry an unclassified failure", () => {
    const RAW_TRANSPORT_FAILURE =
      "HTTP agent target agent.example.com could not be reached: " +
      "TypeError: fetch failed: getaddrinfo ENOTFOUND agent.example.com";

    async function finishWith(results: SimulationResults) {
      const handler = new FinishRunCommand(makeDeps());
      const events = await handler.handle(
        makeCommand({ status: "ERROR", results }) as any,
      );
      return (events[0]!.data as { results?: SimulationResults }).results!;
    }

    /** @scenario "Caller-supplied results whose reasoning is the raw failure are classified before storage" */
    it("classifies results whose reasoning is the raw failure itself", async () => {
      const stored = await finishWith({
        verdict: "failure",
        reasoning: RAW_TRANSPORT_FAILURE,
        metCriteria: [],
        unmetCriteria: [],
        error: RAW_TRANSPORT_FAILURE,
      });

      expect(stored.reasoning).not.toBe(RAW_TRANSPORT_FAILURE);
      expect(stored.reasoning).not.toContain("TypeError");
      expect(decodeScenarioError(stored.error)?.code).toBe(
        ScenarioInfraErrorCode.PlatformUnreachable,
      );
    });

    /** @scenario "Caller-supplied results with an error and no reasoning are classified before storage" */
    it("classifies results that carry an error and no reasoning", async () => {
      const stored = await finishWith({
        verdict: "failure",
        metCriteria: [],
        unmetCriteria: [],
        error: "connect ECONNREFUSED 127.0.0.1:8080",
      });

      expect(stored.reasoning).toBeDefined();
      expect(stored.reasoning).not.toContain("ECONNREFUSED");
      expect(decodeScenarioError(stored.error)?.code).toBe(
        ScenarioInfraErrorCode.PlatformUnreachable,
      );
    });

    /** @scenario "A cancelled run stores the inconclusive verdict, not a raw failure verdict" */
    it("stores the inconclusive verdict for a cancelled run", async () => {
      const handler = new FinishRunCommand(makeDeps());
      const events = await handler.handle(
        makeCommand({
          status: "CANCELLED",
          results: {
            verdict: "failure",
            metCriteria: [],
            unmetCriteria: [],
            error: RAW_TRANSPORT_FAILURE,
          },
        }) as any,
      );
      const stored = (events[0]!.data as { results?: SimulationResults })
        .results!;

      expect(stored.verdict).toBe("inconclusive");
      expect(stored.reasoning).toBe("Cancelled by user");
    });

    /** @scenario "Results a judge wrote are stored untouched" */
    it("leaves results a judge wrote alone", async () => {
      const supplied: SimulationResults = {
        verdict: "failure",
        reasoning: "The agent never offered the refund window.",
        metCriteria: ["was polite"],
        unmetCriteria: ["offered a refund"],
        error: "criteria not met",
      };

      expect(await finishWith(supplied)).toEqual(supplied);
    });

    /** @scenario "Passing results are never reclassified" */
    it("leaves a passing verdict alone", async () => {
      const supplied: SimulationResults = {
        verdict: "success",
        metCriteria: ["was polite"],
        unmetCriteria: [],
      };

      expect(await finishWith(supplied)).toEqual(supplied);
    });

    it("leaves results carrying no error at all alone", async () => {
      const supplied: SimulationResults = {
        verdict: "inconclusive",
        reasoning: "The judge could not decide.",
        metCriteria: [],
        unmetCriteria: [],
      };

      expect(await finishWith(supplied)).toEqual(supplied);
    });
  });

  describe("when the caller uses the static routing helpers", () => {
    it("keeps the routing/idempotency contract of the old pure command", () => {
      const payload = makeCommand().data;
      expect(FinishRunCommand.getAggregateId(payload)).toBe("run-1");
      expect(FinishRunCommand.getSpanAttributes(payload)).toEqual({
        "payload.scenarioRun.id": "run-1",
      });
      expect(FinishRunCommand.makeJobId(payload)).toBe(
        "tenant-1:run-1:finish-run",
      );
    });
  });
});
