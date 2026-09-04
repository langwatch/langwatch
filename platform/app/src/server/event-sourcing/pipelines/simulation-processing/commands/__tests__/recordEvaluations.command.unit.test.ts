import { describe, expect, it, vi } from "vitest";
import type { ScenarioEvaluationResult } from "~/server/scenarios/schemas/event-schemas";
import type { RecordEvaluationsCommandData } from "../../schemas/commands";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import type { SimulationProcessingEvent } from "../../schemas/events";
import type { RecordEvaluationsDeps } from "../recordEvaluations.command";
import {
  evaluationsFingerprint,
  RecordEvaluationsCommand,
} from "../recordEvaluations.command";

const FAILED_REQUIRED: ScenarioEvaluationResult = {
  evaluatorId: "ragas/sql_query_equivalence",
  name: "SQL Query Equivalence",
  status: "failed",
  required: true,
  passed: false,
};

const PASSED_REQUIRED: ScenarioEvaluationResult = {
  ...FAILED_REQUIRED,
  status: "passed",
  passed: true,
};

function makeDeps(events: SimulationProcessingEvent[] = []) {
  const loadPriorEvents = vi.fn().mockResolvedValue(events);
  return { loadPriorEvents } as RecordEvaluationsDeps & {
    loadPriorEvents: typeof loadPriorEvents;
  };
}

function makeCommand(overrides: Partial<RecordEvaluationsCommandData> = {}): {
  tenantId: string;
  data: RecordEvaluationsCommandData;
} {
  return {
    tenantId: "tenant-1",
    data: {
      tenantId: "tenant-1",
      scenarioRunId: "run-1",
      evaluations: [FAILED_REQUIRED],
      occurredAt: 5_000,
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

function startedEvent(): SimulationProcessingEvent {
  return {
    type: SIMULATION_RUN_EVENT_TYPES.STARTED,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
    },
  } as SimulationProcessingEvent;
}

function finishedEvent(
  overrides: Record<string, unknown> = {},
): SimulationProcessingEvent {
  return {
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    data: {
      scenarioRunId: "run-1",
      status: "SUCCESS",
      results: {
        verdict: "success",
        metCriteria: [],
        unmetCriteria: [],
      },
      ...overrides,
    },
  } as SimulationProcessingEvent;
}

function evaluatedEvent(
  overrides: Record<string, unknown> = {},
): SimulationProcessingEvent {
  return {
    type: SIMULATION_RUN_EVENT_TYPES.EVALUATED,
    data: {
      scenarioRunId: "run-1",
      evaluations: [FAILED_REQUIRED],
      verdict: "failure",
      status: "FAILURE",
      previousVerdict: "success",
      previousStatus: "SUCCESS",
      ...overrides,
    },
  } as SimulationProcessingEvent;
}

describe("RecordEvaluationsCommand", () => {
  describe("when the run has not finished", () => {
    /** @scenario "Recording evaluations on a run that has not finished is refused" */
    it("refuses the command", async () => {
      const handler = new RecordEvaluationsCommand(
        makeDeps([queuedEvent(), startedEvent()]),
      );

      await expect(handler.handle(makeCommand() as any)).rejects.toThrowError(
        /has not finished/,
      );
    });
  });

  describe("when a successful run gets a required failure", () => {
    /** @scenario "Recording evaluations carries the verdict the run held before" */
    it("emits an evaluated event that says what the run held before and holds now", async () => {
      const deps = makeDeps([queuedEvent(), startedEvent(), finishedEvent()]);
      const handler = new RecordEvaluationsCommand(deps);

      const events = await handler.handle(makeCommand() as any);

      expect(deps.loadPriorEvents).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        scenarioRunId: "run-1",
      });
      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.type).toBe(SIMULATION_RUN_EVENT_TYPES.EVALUATED);
      expect(event.version).toBe(SIMULATION_EVENT_VERSIONS.EVALUATED);
      expect(event.aggregateId).toBe("run-1");
      expect(event.occurredAt).toBe(5_000);
      expect(event.data).toEqual({
        scenarioRunId: "run-1",
        evaluations: [FAILED_REQUIRED],
        verdict: "failure",
        status: "FAILURE",
        previousVerdict: "success",
        previousStatus: "SUCCESS",
        scenarioId: "scenario-1",
        batchRunId: "batch-1",
        scenarioSetId: "set-1",
      });
    });
  });

  describe("when the finished event carries its own identity", () => {
    it("prefers it over the queued event", async () => {
      const handler = new RecordEvaluationsCommand(
        makeDeps([
          queuedEvent(),
          finishedEvent({
            scenarioId: "scenario-finished",
            batchRunId: "batch-finished",
            scenarioSetId: "set-finished",
          }),
        ]),
      );

      const [event] = await handler.handle(makeCommand() as any);

      expect(event!.data).toMatchObject({
        scenarioId: "scenario-finished",
        batchRunId: "batch-finished",
        scenarioSetId: "set-finished",
      });
    });
  });

  describe("when nothing gates", () => {
    it("keeps the judge's verdict and status", async () => {
      const handler = new RecordEvaluationsCommand(
        makeDeps([queuedEvent(), finishedEvent()]),
      );

      const [event] = await handler.handle(
        makeCommand({ evaluations: [PASSED_REQUIRED] }) as any,
      );

      expect(event!.data).toMatchObject({
        verdict: "success",
        status: "SUCCESS",
        previousVerdict: "success",
        previousStatus: "SUCCESS",
      });
    });
  });

  describe("when the run errored before any judgement", () => {
    it("keeps the error status and carries no verdict", async () => {
      const handler = new RecordEvaluationsCommand(
        makeDeps([
          queuedEvent(),
          finishedEvent({ status: "ERROR", results: undefined }),
        ]),
      );

      const [event] = await handler.handle(
        makeCommand({ evaluations: [PASSED_REQUIRED] }) as any,
      );

      expect(event!.data).toMatchObject({
        status: "ERROR",
        previousStatus: "ERROR",
      });
      expect(event!.data).not.toHaveProperty("verdict");
      expect(event!.data).not.toHaveProperty("previousVerdict");
    });
  });

  describe("when evaluations were recorded before", () => {
    it("reads what the run held from the last evaluated event", async () => {
      const handler = new RecordEvaluationsCommand(
        makeDeps([queuedEvent(), finishedEvent(), evaluatedEvent()]),
      );

      const [event] = await handler.handle(
        makeCommand({ evaluations: [PASSED_REQUIRED] }) as any,
      );

      expect(event!.data).toMatchObject({
        verdict: "success",
        status: "SUCCESS",
        previousVerdict: "failure",
        previousStatus: "FAILURE",
      });
    });
  });

  describe("when the same evaluations are recorded twice", () => {
    /** @scenario "Recording the same evaluations twice records one event" */
    it("carries the same idempotency key, and a different set carries a new one", async () => {
      const handler = new RecordEvaluationsCommand(
        makeDeps([queuedEvent(), finishedEvent()]),
      );

      const [first] = await handler.handle(makeCommand() as any);
      const [second] = await handler.handle(
        makeCommand({ occurredAt: 6_000 }) as any,
      );
      const [changed] = await handler.handle(
        makeCommand({ evaluations: [PASSED_REQUIRED] }) as any,
      );

      expect(first!.idempotencyKey).toBe(
        `tenant-1:run-1:recordEvaluations:${evaluationsFingerprint([FAILED_REQUIRED])}`,
      );
      expect(second!.idempotencyKey).toBe(first!.idempotencyKey);
      expect(changed!.idempotencyKey).not.toBe(first!.idempotencyKey);
      expect(RecordEvaluationsCommand.makeJobId(makeCommand().data)).toBe(
        `tenant-1:run-1:record-evaluations:${evaluationsFingerprint([FAILED_REQUIRED])}`,
      );
    });
  });
});
