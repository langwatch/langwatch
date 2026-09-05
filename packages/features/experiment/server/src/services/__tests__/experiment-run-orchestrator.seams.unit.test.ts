/**
 * Facade-level seams: behaviour that crosses two collaborators, or proves
 * the facade's delegation is wired rather than merely present.
 * @see specs/experiments-v3/evaluation-execution.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { EvaluationsV3State } from "@langwatch/experiment-contract";
import type { CallOutcome } from "@langwatch/agent-contract";
import {
  type ConnectedDispatch,
  ExperimentRunOrchestratorService,
  type ExperimentRunPorts,
} from "../experiment-run-orchestrator.service";

const createTestDataset = (rowCount = 3) =>
  Array.from({ length: rowCount }, (_, i) => ({
    question: `Question ${i}`,
    expected: `Answer ${i}`,
  }));

describe("given two datasets where the active one is not the first", () => {
  const twoDatasetState = (): Pick<
    EvaluationsV3State,
    "datasets" | "activeDatasetId" | "targets" | "evaluators"
  > => ({
    datasets: [
      { id: "dataset-old", name: "Old" },
      { id: "dataset-active", name: "Active" },
    ] as EvaluationsV3State["datasets"],
    activeDatasetId: "dataset-active",
    targets: [
      {
        id: "target-1",
        type: "prompt",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {
          "dataset-active": {
            input: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-active",
              sourceField: "question",
            },
          },
        },
      },
    ] as EvaluationsV3State["targets"],
    evaluators: [
      {
        id: "eval-1",
        evaluatorType: "langevals/exact_match",
        inputs: [
          { identifier: "output", type: "str" },
          { identifier: "expected_output", type: "str" },
        ],
        mappings: {
          "dataset-active": {
            "target-1": {
              output: {
                type: "source",
                source: "target",
                sourceId: "target-1",
                sourceField: "output",
              },
              expected_output: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-active",
                sourceField: "expected",
              },
            },
          },
        },
      },
    ] as EvaluationsV3State["evaluators"],
  });

  describe("when the run builds its cells", () => {
    /** @scenario "The run reads its mappings from the dataset the rows come from" */
    it("reads the mapping bucket of the active dataset", () => {
      const cells = ExperimentRunOrchestratorService.generateCells(
        twoDatasetState(),
        createTestDataset(1),
        {
          type: "full",
        },
      );

      expect(cells).toHaveLength(1);
      expect(cells[0]?.datasetEntry._datasetId).toBe("dataset-active");
    });

    /** @scenario "The run reads its mappings from the dataset the rows come from" */
    it("resolves the evaluator's inputs instead of dispatching an empty payload", () => {
      const cells = ExperimentRunOrchestratorService.generateCells(
        twoDatasetState(),
        createTestDataset(1),
        {
          type: "full",
        },
      );

      expect(
        ExperimentRunOrchestratorService.buildEvaluatorInputs(cells[0]!, "eval-1", {
          output: "Answer 0",
        }),
      ).toEqual({
        output: "Answer 0",
        expected_output: "Answer 0",
      });
    });
  });
});

describe("given a run whose target is a connected agent", () => {
  /**
   * S6 moved `dispatch`/`sleep`/`now` from a per-call argument to a
   * `create` dependency. This proves the facade still forwards the
   * caller's injected versions rather than the service's own defaults.
   */
  it("forwards the injected dispatcher, clock and sleep into the connected cell service", async () => {
    const agent = {
      id: "agent-1",
      name: "support-agent",
      environment: "production",
      config: { parameters: [] },
    } as any;
    const cell = {
      rowIndex: 0,
      targetId: "connected-target",
      targetConfig: {
        id: "connected-target",
        type: "agent",
        agentType: "connected",
        dbAgentId: "agent-1",
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
      },
      evaluatorConfigs: [],
      datasetEntry: {},
    } as any;
    const ports = { studio: { postEvent: async () => {} } } as unknown as ExperimentRunPorts;
    const workflows = {
      prepareStudioEvent: async ({ event }: { event: unknown }) => event,
    } as any;

    const dispatch = vi.fn<ConnectedDispatch>(async (): Promise<CallOutcome> => ({
      output: "ok",
      instance: { instanceId: "inst_1", hostname: "host", label: null },
      durationMs: 1,
    }));
    const sleep = vi.fn(async () => undefined);
    const now = vi.fn(() => 42);

    const events = [];
    for await (const event of ExperimentRunOrchestratorService.executeConnectedCell({
      cell,
      projectId: "p1",
      agent,
      dispatch,
      sleep,
      now,
      ports,
      workflows,
    })) {
      events.push(event);
    }

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(now).toHaveBeenCalled();
    const result = events[1] as { duration?: number };
    // Every read of the injected clock returns 42, so a duration of 0
    // proves the service read `now`, not `Date.now`.
    expect(result.duration).toBe(0);
  });
});
