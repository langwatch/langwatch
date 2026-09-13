import { describe, expect, it, vi } from "vitest";
import type { Command } from "~/server/event-sourcing";
import type { EvaluatorAttachment } from "~/server/scenarios/evaluator-attachments";
import type {
  RunEvaluatorDefinition,
  RunEvaluators,
} from "~/server/scenarios/scenario-run-evaluators";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import type { FinishRunCommandData } from "../../schemas/commands";
import {
  SIMULATION_RUN_COMMAND_TYPES,
  SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import type { SimulationProcessingEvent } from "../../schemas/events";
import type { FinishRunDeps } from "../finishRun.command";
import { FinishRunCommand } from "../finishRun.command";
import type { QueueRunCommandData } from "../queueRun.command";
import { QueueRunCommand } from "../queueRun.command";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const ATTACHMENT: EvaluatorAttachment = {
  id: "att-1",
  evaluatorId: "eval-1",
  required: true,
  mappings: {},
};

const DEFINITION: RunEvaluatorDefinition = {
  id: "eval-1",
  name: "Exact match",
  type: "evaluator",
  evaluatorType: "langevals/exact_match",
  workflowId: null,
  settings: { case_sensitive: true },
  fields: [{ identifier: "output", type: "str" }],
};

const SET_ID = getSuiteSetId("plan-1");

function evaluators(overrides: Partial<RunEvaluators> = {}): RunEvaluators {
  return {
    suiteId: "suite-1",
    planId: "plan-1",
    attachments: [ATTACHMENT],
    fieldValues: { golden_sql: "SELECT 1" },
    definitions: [DEFINITION],
    ...overrides,
  };
}

function queueCommand(overrides: Partial<QueueRunCommandData> = {}) {
  return {
    tenantId: "tenant-1",
    aggregateId: "run-1",
    type: SIMULATION_RUN_COMMAND_TYPES.QUEUE,
    data: {
      tenantId: "tenant-1",
      occurredAt: 1_000,
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: SET_ID,
      ...overrides,
    } as QueueRunCommandData,
  } as Command<QueueRunCommandData>;
}

function finishCommand() {
  return {
    tenantId: "tenant-1",
    aggregateId: "run-1",
    type: SIMULATION_RUN_COMMAND_TYPES.FINISH,
    data: {
      tenantId: "tenant-1",
      scenarioRunId: "run-1",
      occurredAt: 2_000,
      status: "SUCCESS",
    },
  } as Command<FinishRunCommandData>;
}

function queuedEvent(carried: RunEvaluators | undefined) {
  return {
    type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: SET_ID,
      ...(carried && { evaluators: carried }),
    },
  } as unknown as SimulationProcessingEvent;
}

describe("the evaluators a run is graded with", () => {
  describe("when a run is queued", () => {
    /** @scenario "The evaluators a run is graded with are resolved when it is queued" */
    it("records the attachments its suite and plan carry on the queued event", async () => {
      const loadRunAttachments = vi.fn(async () => evaluators());

      const events = await new QueueRunCommand({ loadRunAttachments }).handle(
        queueCommand(),
      );

      expect(loadRunAttachments).toHaveBeenCalledWith({
        projectId: "tenant-1",
        scenarioId: "scenario-1",
        planId: "plan-1",
      });
      expect(events[0]?.data).toMatchObject({ evaluators: evaluators() });
    });

    /** @scenario "The scenario field values a run is graded with are resolved when it is queued" */
    /** @scenario "The evaluator definitions a run is graded with are resolved when it is queued" */
    it("records the scenario's field values and the evaluator definitions next to the attachments", async () => {
      const loadRunAttachments = vi.fn(async () => evaluators());

      const events = await new QueueRunCommand({ loadRunAttachments }).handle(
        queueCommand(),
      );

      const carried = (events[0]?.data as { evaluators: RunEvaluators })
        .evaluators;
      expect(carried.fieldValues).toEqual({ golden_sql: "SELECT 1" });
      expect(carried.definitions).toEqual([DEFINITION]);
    });

    it("keeps the attachments the caller already resolved", async () => {
      const loadRunAttachments = vi.fn(async () => evaluators());
      const supplied = evaluators({ suiteId: "suite-2" });

      const events = await new QueueRunCommand({ loadRunAttachments }).handle(
        queueCommand({ evaluators: supplied }),
      );

      expect(loadRunAttachments).not.toHaveBeenCalled();
      expect(events[0]?.data).toMatchObject({ evaluators: supplied });
    });

    it("queues the run anyway when the attachments cannot be read", async () => {
      const loadRunAttachments = vi.fn(async () => {
        throw new Error("postgres is down");
      });

      const events = await new QueueRunCommand({ loadRunAttachments }).handle(
        queueCommand(),
      );

      expect(events).toHaveLength(1);
      expect(events[0]?.data).not.toHaveProperty("evaluators");
    });
  });

  describe("when a run finishes", () => {
    /** @scenario "The finished event carries the attachments the run was queued with" */
    it("carries the attachments the run was queued with, not the current ones", async () => {
      const queued = evaluators({ suiteId: "suite-at-queue-time" });
      const deps: FinishRunDeps = {
        loadPriorEvents: vi.fn(async () => [queuedEvent(queued)]),
        loadRunAttachments: vi.fn(async () =>
          evaluators({ suiteId: "suite-edited-since" }),
        ),
      };

      const events = await new FinishRunCommand(deps).handle(finishCommand());

      expect(deps.loadRunAttachments).not.toHaveBeenCalled();
      expect(events[0]?.data).toMatchObject({ evaluators: queued });
    });

    /** @scenario "The finished event carries the field values and the definitions the run was queued with" */
    it("carries the field values and the definitions the run was queued with, not the edited ones", async () => {
      const queued = evaluators();
      const deps: FinishRunDeps = {
        loadPriorEvents: vi.fn(async () => [queuedEvent(queued)]),
        loadRunAttachments: vi.fn(async () =>
          evaluators({
            fieldValues: { golden_sql: "SELECT 2" },
            definitions: [
              { ...DEFINITION, settings: { case_sensitive: false } },
            ],
          }),
        ),
      };

      const events = await new FinishRunCommand(deps).handle(finishCommand());

      expect(deps.loadRunAttachments).not.toHaveBeenCalled();
      const carried = (events[0]?.data as { evaluators: RunEvaluators })
        .evaluators;
      expect(carried.fieldValues).toEqual({ golden_sql: "SELECT 1" });
      expect(carried.definitions).toEqual([DEFINITION]);
    });

    /** @scenario "A run with no queued attachments resolves them when it finishes" */
    it("resolves them now for a run whose events carry none", async () => {
      const current = evaluators({ suiteId: "suite-now" });
      const deps: FinishRunDeps = {
        loadPriorEvents: vi.fn(async () => [queuedEvent(undefined)]),
        loadRunAttachments: vi.fn(async () => current),
      };

      const events = await new FinishRunCommand(deps).handle(finishCommand());

      expect(deps.loadRunAttachments).toHaveBeenCalledWith({
        projectId: "tenant-1",
        scenarioId: "scenario-1",
        planId: "plan-1",
      });
      expect(events[0]?.data).toMatchObject({ evaluators: current });
    });

    it("finishes the run anyway when the attachments cannot be read", async () => {
      const deps: FinishRunDeps = {
        loadPriorEvents: vi.fn(async () => [queuedEvent(undefined)]),
        loadRunAttachments: vi.fn(async () => {
          throw new Error("postgres is down");
        }),
      };

      const events = await new FinishRunCommand(deps).handle(finishCommand());

      expect(events).toHaveLength(1);
      expect(events[0]?.data).not.toHaveProperty("evaluators");
    });
  });
});
