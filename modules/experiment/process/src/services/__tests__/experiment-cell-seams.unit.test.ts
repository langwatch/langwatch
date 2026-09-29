import type { CallOutcome } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { EvaluationsV3State } from "@langwatch/experiment-contract";
/**
 * Seams a cell crosses: behaviour that spans two collaborators, or proves
 * an injected dependency is wired rather than merely present.
 * @see specs/experiments-v3/evaluation-execution.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { ExperimentRunCollaborators } from "../../rules/experiment-run-input.rules.ts";
import { ExperimentCellExecutionService } from "../experiment-cell-execution.service.ts";
import { ExperimentCellPlanService } from "../experiment-cell-plan.service.ts";
import {
  type ConnectedDispatch,
  ExperimentConnectedCellService,
} from "../experiment-connected-cell.service.ts";
import { ExperimentEvaluatorInputService } from "../experiment-evaluator-input.service.ts";
import { createNoAttachmentsFixture } from "./experiment-attachments.fixture.ts";

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
      const cells = ExperimentCellPlanService.create().generateCells({
        state: twoDatasetState(),
        datasetRows: createTestDataset(1),
        scope: {
          type: "full",
        },
      });

      expect(cells).toHaveLength(1);
      expect(cells[0]?.datasetEntry._datasetId).toBe("dataset-active");
    });

    /** @scenario "The run reads its mappings from the dataset the rows come from" */
    it("resolves the evaluator's inputs instead of dispatching an empty payload", () => {
      const cells = ExperimentCellPlanService.create().generateCells({
        state: twoDatasetState(),
        datasetRows: createTestDataset(1),
        scope: {
          type: "full",
        },
      });

      expect(
        ExperimentEvaluatorInputService.create({}).buildEvaluatorInputs({
          cell: cells[0]!,
          evaluatorId: "eval-1",
          targetOutput: { output: "Answer 0" },
        }),
      ).toEqual({
        output: "Answer 0",
        expected_output: "Answer 0",
      });
    });
  });
});

describe("given a run whose target is a connected agent", () => {
  /** Proves the service runs on the injected dispatcher, clock and sleep, not its own defaults. */
  it("runs the connected cell on the injected dispatcher, clock and sleep", async () => {
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
    const ports = createApiFixture<ExperimentRunCollaborators>(
      {
        attachments: createNoAttachmentsFixture(),
        studio: { postStudioEvent: async () => {} },
      },
      "ports",
    );
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
    const connected = ExperimentConnectedCellService.create({
      ports,
      workflows,
      cells: ExperimentCellExecutionService.create({ ports, workflows }),
      dispatch,
      sleep,
      now,
    });
    for await (const event of connected.executeConnectedCell({ cell, projectId: "p1", agent })) {
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
