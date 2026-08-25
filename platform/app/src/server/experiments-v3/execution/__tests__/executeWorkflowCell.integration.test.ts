/**
 * Tests executeWorkflowCell: running a whole studio workflow as an
 * evaluations-v3 target. The nlpgo dispatch boundary (and env injection /
 * dataset inlining) is mocked and fed a scripted set of server events, so this
 * runs the classification and mapping logic without a live NLP service.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluatorConfig } from "~/experiments-v3/types";
import type { StudioWorkflow } from "@langwatch/workflow-contract";
import type { StudioServerEvent } from "~/optimization_studio/types/events";

// vi.mock is hoisted above declarations, so the scripted events live in a
// hoisted holder the mock factory can safely close over. The workflow run and
// the grading evaluators are two separate dispatches, so they are scripted
// separately and the mock answers each by the message it was given.
const scripted = vi.hoisted(() => ({
  flow: [] as StudioServerEvent[],
  component: [] as StudioServerEvent[],
  componentThrows: undefined as Error | undefined,
  dispatched: [] as Array<{ type: string; payload: Record<string, any> }>,
}));

vi.mock("~/app/api/workflows/post_event/post-event", () => ({
  studioBackendPostEvent: vi.fn(
    async ({
      message,
      onEvent,
    }: {
      message: { type: string; payload: Record<string, any> };
      onEvent: (event: StudioServerEvent) => void;
    }) => {
      scripted.dispatched.push(message);
      if (message.type === "execute_component") {
        if (scripted.componentThrows) throw scripted.componentThrows;
        for (const event of scripted.component) onEvent(event);
        return;
      }
      for (const event of scripted.flow) onEvent(event);
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
} as unknown as StudioWorkflow;

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

/**
 * A grading evaluator attached to the target column in the workbench, reading
 * one of the workflow's results. This is not one of the workflow's own
 * evaluator nodes — it exists only in the workbench.
 */
const gradingEvaluator = (sourceField: string): EvaluatorConfig => ({
  id: "eval-grading",
  evaluatorType: "langevals/exact_match",
  dbEvaluatorId: "db-eval-1",
  inputs: [{ identifier: "output", type: "str" }],
  mappings: {
    "dataset-1": {
      "wf-target": {
        output: {
          type: "source",
          source: "target",
          sourceId: "wf-target",
          sourceField,
        },
      },
    },
  },
});

const run = async (cell: ExecutionCell): Promise<EvaluationV3Event[]> => {
  const events: EvaluationV3Event[] = [];
  for await (const event of executeWorkflowCell({
    cell,
    projectId: "p1",
    workflowDsl,
    datasetColumns: [{ id: "col_1", name: "question", type: "string" }],
  })) {
    events.push(event);
  }
  return events;
};

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
] as unknown as StudioServerEvent[];

/** Two results on the end node, the shape that exposed the bug. */
const twoResultRun: StudioServerEvent[] = [
  {
    type: "execution_state_change",
    payload: {
      execution_state: {
        status: "success",
        trace_id: "trace_wf_0",
        result: { output: "yes", chunks: { a: 1 } },
        timestamps: { started_at: 1000, finished_at: 1500 },
      },
    },
  },
  { type: "done" },
] as unknown as StudioServerEvent[];

const failingRun: StudioServerEvent[] = [
  {
    type: "execution_state_change",
    payload: {
      execution_state: {
        status: "error",
        trace_id: "trace_wf_0",
        error: "the http call timed out",
      },
    },
  },
  { type: "done" },
] as unknown as StudioServerEvent[];

const gradingSuccess: StudioServerEvent[] = [
  {
    type: "component_state_change",
    payload: {
      component_id: "wf-target.eval-grading",
      execution_state: {
        status: "success",
        outputs: { score: 1, passed: true },
      },
    },
  },
] as unknown as StudioServerEvent[];

beforeEach(() => {
  scripted.flow = [];
  scripted.component = [];
  scripted.componentThrows = undefined;
  scripted.dispatched = [];
});

describe("executeWorkflowCell", () => {
  describe("given a workflow run that succeeds with an evaluator node", () => {
    describe("when the cell is executed", () => {
      /** @scenario "A workflow target produces one result per dataset row" */
      it("yields exactly one target_result from the workflow end-node result", async () => {
        scripted.flow = succeedingRun;
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
        scripted.flow = succeedingRun;
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
        scripted.flow = succeedingRun;
        const events = await run(makeCell());

        const target = events.find((e) => e.type === "target_result");
        expect(target?.type === "target_result" && target.cost).toBe(0.75);
        expect(target?.type === "target_result" && target.duration).toBe(500);
      });
    });
  });

  describe("given a grading evaluator attached to the workflow target", () => {
    describe("when the workflow run succeeds", () => {
      /** @scenario "An evaluator attached to a workflow target runs against its results" */
      it("dispatches the evaluator and yields its score", async () => {
        scripted.flow = twoResultRun;
        scripted.component = gradingSuccess;

        const events = await run(
          makeCell({ evaluatorConfigs: [gradingEvaluator("output")] }),
        );

        const graded = events.find(
          (e) =>
            e.type === "evaluator_result" && e.evaluatorId === "eval-grading",
        );
        expect(graded).toMatchObject({ rowIndex: 0, targetId: "wf-target" });
        expect(
          graded?.type === "evaluator_result" && graded.result,
        ).toMatchObject({ status: "processed", score: 1, passed: true });
      });

      /** @scenario "An evaluator can read a result other than the first one" */
      it("resolves a mapping onto a result other than output", async () => {
        scripted.flow = twoResultRun;
        scripted.component = gradingSuccess;

        await run(makeCell({ evaluatorConfigs: [gradingEvaluator("chunks")] }));

        const componentDispatch = scripted.dispatched.find(
          (m) => m.type === "execute_component",
        );
        expect(componentDispatch?.payload.node_id).toBe(
          "wf-target.eval-grading",
        );
        expect(componentDispatch?.payload.inputs).toEqual({
          output: { a: 1 },
        });
      });

      /** @scenario "An evaluator can read a result other than the first one" */
      it("runs the evaluator inside the same trace as the workflow", async () => {
        scripted.flow = twoResultRun;
        scripted.component = gradingSuccess;

        await run(makeCell({ evaluatorConfigs: [gradingEvaluator("output")] }));

        const componentDispatch = scripted.dispatched.find(
          (m) => m.type === "execute_component",
        );
        expect(componentDispatch?.payload.trace_id).toBe("trace_wf_0");
      });
    });

    describe("when the workflow run fails", () => {
      /** @scenario "A failing workflow row does not run its evaluators" */
      it("reports the workflow error and dispatches no evaluator", async () => {
        scripted.flow = failingRun;
        scripted.component = gradingSuccess;

        const events = await run(
          makeCell({ evaluatorConfigs: [gradingEvaluator("output")] }),
        );

        const target = events.find((e) => e.type === "target_result");
        expect(target).toBeDefined();
        expect(target?.type === "target_result" && target.error).toBe(
          "the http call timed out",
        );
        expect(
          scripted.dispatched.some((m) => m.type === "execute_component"),
        ).toBe(false);
        expect(
          events.some(
            (e) =>
              e.type === "evaluator_result" && e.evaluatorId === "eval-grading",
          ),
        ).toBe(false);
      });
    });

    describe("when the evaluator itself fails", () => {
      /** @scenario "An evaluator that fails does not lose the workflow's own result" */
      it("keeps the workflow result and reports the evaluator error", async () => {
        scripted.flow = twoResultRun;
        scripted.componentThrows = new Error("evaluator service unreachable");

        const events = await run(
          makeCell({ evaluatorConfigs: [gradingEvaluator("output")] }),
        );

        const target = events.find((e) => e.type === "target_result");
        expect(target).toBeDefined();
        expect(target?.type === "target_result" && target.output).toEqual({
          output: "yes",
          chunks: { a: 1 },
        });
        expect(
          target?.type === "target_result" && target.error,
        ).toBeUndefined();

        const graded = events.find(
          (e) =>
            e.type === "evaluator_result" && e.evaluatorId === "eval-grading",
        );
        expect(graded).toBeDefined();
        expect(
          graded?.type === "evaluator_result" && graded.result,
        ).toMatchObject({ status: "error", error_type: "EvaluatorError" });
      });
    });
  });
});
