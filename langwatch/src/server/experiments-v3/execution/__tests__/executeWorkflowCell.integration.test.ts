/**
 * Tests executeWorkflowCell: running a whole studio workflow as an
 * evaluations-v3 target. The nlpgo dispatch boundary (and env injection /
 * dataset inlining) is mocked and fed a scripted set of server events, so this
 * runs the classification and mapping logic without a live NLP service.
 */
import { describe, expect, it, vi } from "vitest";
import type { Workflow } from "~/optimization_studio/types/dsl";
import type { StudioServerEvent } from "~/optimization_studio/types/events";

// vi.mock is hoisted above declarations, so the scripted events live in a
// hoisted holder the mock factory can safely close over.
const scripted = vi.hoisted(() => ({ events: [] as StudioServerEvent[] }));

vi.mock("~/app/api/workflows/post_event/post-event", () => ({
  studioBackendPostEvent: vi.fn(
    async ({ onEvent }: { onEvent: (event: StudioServerEvent) => void }) => {
      for (const event of scripted.events) onEvent(event);
    },
  ),
}));
vi.mock("~/optimization_studio/server/addEnvs", () => ({
  addEnvs: vi.fn(async (event: unknown) => event),
}));
vi.mock("~/optimization_studio/server/loadDatasets", () => ({
  loadDatasets: vi.fn(async (event: unknown) => event),
}));

import { executeWorkflowCell } from "../orchestrator";
import type { EvaluationV3Event, ExecutionCell } from "../types";

const workflowDsl = {
  nodes: [
    { id: "entry", type: "entry", data: {} },
    { id: "llm", type: "signature", data: {} },
    { id: "eval_1", type: "evaluator", data: { name: "Exact match" } },
    { id: "end", type: "end", data: {} },
  ],
  edges: [],
} as unknown as Workflow;

const makeCell = (overrides?: Partial<ExecutionCell>): ExecutionCell => ({
  rowIndex: 0,
  targetId: "wf-target",
  targetConfig: {
    id: "wf-target",
    type: "workflow",
    workflowId: "wf_1",
    inputs: [],
    outputs: [],
    mappings: {},
  },
  evaluatorConfigs: [],
  datasetEntry: { _datasetId: "dataset-1", question: "is a dog an animal?" },
  ...overrides,
});

const run = async (cell: ExecutionCell): Promise<EvaluationV3Event[]> => {
  const events: EvaluationV3Event[] = [];
  for await (const event of executeWorkflowCell(cell, "p1", workflowDsl)) {
    events.push(event);
  }
  return events;
};

describe("executeWorkflowCell", () => {
  describe("given a workflow run that succeeds with an evaluator node", () => {
    const succeedingRun: StudioServerEvent[] = [
      {
        type: "component_state_change",
        payload: {
          component_id: "llm",
          execution_state: {
            status: "success",
            cost: 0.5,
            outputs: { output: "yes" },
          },
        },
      },
      {
        type: "component_state_change",
        payload: {
          component_id: "eval_1",
          execution_state: {
            status: "success",
            cost: 0.25,
            outputs: { score: "0.85", passed: "true", label: "match" },
          },
        },
      },
      {
        type: "execution_state_change",
        payload: {
          execution_state: {
            status: "success",
            trace_id: "trace_wf_0",
            result: { output: "yes" },
            timestamps: { started_at: 1000, finished_at: 1500 },
          },
        },
      },
      { type: "done" },
    ];

    /** @scenario "A workflow target produces one result per dataset row" */
    it("yields exactly one target_result from the workflow end-node result", async () => {
      scripted.events = succeedingRun;
      const events = await run(makeCell());

      const targets = events.filter((e) => e.type === "target_result");
      expect(targets).toHaveLength(1);
      expect(targets[0]).toMatchObject({
        rowIndex: 0,
        targetId: "wf-target",
        output: "yes",
        traceId: "trace_wf_0",
      });
    });

    /** @scenario "The workflow's own evaluator nodes surface as evaluator results" */
    it("surfaces each workflow evaluator node, coercing string score and passed", async () => {
      scripted.events = succeedingRun;
      const events = await run(makeCell());

      const evaluator = events.find((e) => e.type === "evaluator_result");
      expect(evaluator).toMatchObject({
        rowIndex: 0,
        targetId: "wf-target",
        evaluatorId: "eval_1",
      });
      // Workflow evaluators emit stringy values; they are coerced.
      expect(
        evaluator?.type === "evaluator_result" && evaluator.result,
      ).toMatchObject({
        status: "processed",
        score: 0.85,
        passed: true,
        label: "match",
      });

      // Target result is yielded before the evaluator result so storage can
      // link them.
      const targetIdx = events.findIndex((e) => e.type === "target_result");
      const evalIdx = events.findIndex((e) => e.type === "evaluator_result");
      expect(targetIdx).toBeLessThan(evalIdx);
    });

    /** @scenario "Cost and duration from the workflow run are captured per row" */
    it("captures summed node cost and the run duration on the target result", async () => {
      scripted.events = succeedingRun;
      const events = await run(makeCell());

      const target = events.find((e) => e.type === "target_result");
      expect(target?.type === "target_result" && target.cost).toBe(0.75);
      expect(target?.type === "target_result" && target.duration).toBe(500);
    });
  });
});
