/**
 * @vitest-environment node
 *
 * @see specs/experiments-v3/workbench-versioning.feature
 *
 * A run started by an open workbench tab used to reach the board only through
 * that tab. A background tab holds its save timer and a dropped connection
 * loses the cells the page held, so the run read as complete in its own record
 * while the board still read "No output yet". The streaming route now writes
 * the cells itself, the same way the polling runner does.
 *
 * The route, not the writer, is what this file guards: the wiring is the part
 * that was missing.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { globalForApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import type { ExperimentService } from "~/server/experiments/experiment.service";

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({ user: { id: "user_1" } }),
}));

vi.mock("~/server/app-layer/permissions/imperative", async (importActual) => {
  const actual =
    await importActual<
      typeof import("~/server/app-layer/permissions/imperative")
    >();
  return { ...actual, probeProjectPermission: vi.fn().mockResolvedValue(true) };
});

vi.mock("~/server/experiments-v3/execution/dataLoader", () => ({
  loadExecutionData: vi.fn().mockResolvedValue({
    datasetRows: [{ input: "one" }],
    datasetColumns: [{ id: "input", name: "input", type: "string" }],
    loadedPrompts: new Map(),
    loadedAgents: new Map(),
    loadedEvaluators: new Map(),
    loadedWorkflows: new Map(),
  }),
}));

vi.mock("~/server/posthog", () => ({ trackServerEvent: vi.fn() }));
vi.mock("../../../../ee/billing/nurturing/hooks/featureAdoption", () => ({
  fireExperimentRanNurturing: vi.fn(),
}));

const orchestratorEvents = vi.hoisted(() => ({ events: [] as unknown[] }));
vi.mock("~/server/experiments-v3/execution/orchestrator", () => ({
  requestAbort: vi.fn(),
  runOrchestrator: vi.fn(async function* () {
    for (const event of orchestratorEvents.events) yield event;
  }),
}));

// The run-state store is Redis in production and is not what this file is
// about. Its writes are stubbed so the route's own decisions are all that
// reaches an assertion.
vi.mock("~/server/experiments-v3/execution/runStateManager", () => ({
  runStateManager: {
    createRun: vi.fn().mockResolvedValue(undefined),
    addEvent: vi.fn().mockResolvedValue(undefined),
    completeRun: vi.fn().mockResolvedValue(undefined),
    stopRun: vi.fn().mockResolvedValue(undefined),
    failRun: vi.fn().mockResolvedValue(undefined),
    getRunState: vi.fn().mockResolvedValue(null),
  },
}));

const applyWorkbenchTransform = vi.fn();

const executionRequest = {
  projectId: "project_1",
  experimentId: "experiment_1",
  experimentSlug: "my-evaluation",
  name: "My Evaluation",
  dataset: {
    id: "ds-1",
    name: "Data",
    type: "inline" as const,
    columns: [{ id: "input", name: "input", type: "string" }],
  },
  targets: [],
  evaluators: [],
  scope: { type: "full" as const },
};

/** Drives the route to completion, so the handler has finished when it returns. */
const execute = async (overrides: Record<string, unknown> = {}) => {
  const { app } = await import("../experiments-v3");
  const res = await app.request("/api/experiments/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...executionRequest, ...overrides }),
  });
  await res.text();
  return res;
};

const savedState = () => ({
  name: "My Evaluation",
  datasets: [],
  activeDatasetId: "ds-1",
  targets: [],
  evaluators: [],
  results: {
    status: "idle",
    targetOutputs: {},
    targetMetadata: {},
    evaluatorResults: {},
    errors: {},
  },
  pendingSavedChanges: {},
});

/** What the route asked the workbench to save, run through its own transform. */
const savedResults = () => {
  const call = applyWorkbenchTransform.mock.calls[0]?.[0] as {
    transform: (state: unknown) => { results: Record<string, unknown> };
  };
  return call.transform(savedState()).results;
};

beforeAll(() => {
  globalForApp.__langwatch_app = createTestApp({
    experiments: {
      applyWorkbenchTransform,
    } as unknown as ExperimentService,
  });
});

afterAll(() => {
  globalForApp.__langwatch_app = null;
});

beforeEach(() => {
  applyWorkbenchTransform.mockReset();
  applyWorkbenchTransform.mockResolvedValue({ version: 4 });
  orchestratorEvents.events = [];
});

describe("POST /api/experiments/execute", () => {
  describe("when a run started from the page finishes", () => {
    /** @scenario "A run started from the open page writes its cells too" */
    it("writes the run's cells into the saved state without the tab", async () => {
      orchestratorEvents.events = [
        { type: "execution_started", runId: "swift-bold-fox", total: 1 },
        {
          type: "target_result",
          rowIndex: 0,
          targetId: "target-1",
          output: "an answer",
          cost: 0.5,
        },
        {
          type: "evaluator_result",
          rowIndex: 0,
          targetId: "target-1",
          evaluatorId: "evaluator-1",
          result: { status: "processed", passed: true, score: 1 },
        },
        { type: "done", summary: { total: 1, completed: 1 } },
      ];

      await execute();

      expect(applyWorkbenchTransform).toHaveBeenCalledTimes(1);
      const results = savedResults();
      expect(results.targetOutputs).toEqual({ "target-1": ["an answer"] });
      expect(results.evaluatorResults).toEqual({
        "target-1": {
          "evaluator-1": [{ status: "processed", passed: true, score: 1 }],
        },
      });
    });

    /** @scenario "A version a run wrote names that run" */
    it("names the run on the version it writes", async () => {
      orchestratorEvents.events = [
        { type: "execution_started", runId: "quick-plain-doe", total: 1 },
        {
          type: "target_result",
          rowIndex: 0,
          targetId: "target-1",
          output: "an answer",
        },
        { type: "done", summary: { total: 1, completed: 1 } },
      ];

      await execute();

      expect(applyWorkbenchTransform).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project_1",
          id: "experiment_1",
          actor: { userId: "user_1", label: "user", runId: "quick-plain-doe" },
        }),
      );
    });
  });

  describe("when a run started from the page is stopped", () => {
    /** @scenario "A stopped run started from the open page keeps the cells it produced" */
    it("writes the cells it produced before the stop", async () => {
      orchestratorEvents.events = [
        { type: "execution_started", runId: "calm-eager-owl", total: 2 },
        {
          type: "target_result",
          rowIndex: 0,
          targetId: "target-1",
          output: "the row that finished",
        },
        { type: "stopped", reason: "user" },
      ];

      await execute();

      expect(applyWorkbenchTransform).toHaveBeenCalledTimes(1);
      expect(savedResults().targetOutputs).toEqual({
        "target-1": ["the row that finished"],
      });
    });
  });

  describe("when the run is given its own rows", () => {
    /** @scenario "A run started from the open page with its own rows is not written back" */
    it("writes nothing into the saved state", async () => {
      orchestratorEvents.events = [
        { type: "execution_started", runId: "bold-keen-elk", total: 1 },
        {
          type: "target_result",
          rowIndex: 0,
          targetId: "target-1",
          output: "an answer to a row the board does not hold",
        },
        { type: "done", summary: { total: 1, completed: 1 } },
      ];

      await execute({ data: [{ input: "a row sent in the request" }] });

      expect(applyWorkbenchTransform).not.toHaveBeenCalled();
    });
  });

  describe("when the page names no saved experiment", () => {
    /** @scenario "A run started from a page with no saved experiment is not written back" */
    it("writes nothing into the saved state", async () => {
      orchestratorEvents.events = [
        { type: "execution_started", runId: "keen-plain-ram", total: 1 },
        {
          type: "target_result",
          rowIndex: 0,
          targetId: "target-1",
          output: "an answer",
        },
        { type: "done", summary: { total: 1, completed: 1 } },
      ];

      await execute({ experimentId: undefined });

      expect(applyWorkbenchTransform).not.toHaveBeenCalled();
    });
  });
});
