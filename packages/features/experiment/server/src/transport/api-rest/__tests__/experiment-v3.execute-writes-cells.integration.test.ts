/**
 * @see specs/experiments-v3/workbench-versioning.feature
 *
 * A run started by an open workbench tab used to reach the board only through
 * that tab. A background tab holds its save timer and a dropped connection
 * loses the cells the page held, so the run read as complete in its own record
 * while the board still read "No output yet". The streaming route now writes
 * the cells itself, the same way the polling runner does.
 *
 * The ROUTE, not the writer, is what this file guards: the wiring is the part
 * that was missing. Ported from
 * `platform/app/src/server/routes/__tests__/experiments-execute-writes-cells.integration.test.ts`
 * (#7629), where the route read its collaborators off a module-global app; the
 * family takes them as ports now, so the fakes are passed in rather than
 * mocked into place. Its `applyWorkbenchTransform` assertions become the
 * read-then-write pair this seam is built from.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { Hono, type ErrorHandler } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const orchestratorEvents = vi.hoisted(() => ({ events: [] as unknown[] }));

vi.mock("../../../services/experiment-run-orchestrator.service", () => ({
  requestAbort: vi.fn(),
  runOrchestrator: vi.fn(async function* () {
    for (const event of orchestratorEvents.events) yield event;
  }),
}));

vi.mock("../../../services/experiment-execution-data.service", () => ({
  loadExecutionData: vi.fn(async () => ({
    datasetRows: [{ input: "one" }],
    datasetColumns: [{ id: "input", name: "input", type: "string" }],
    loadedPrompts: new Map(),
    loadedAgents: new Map(),
    loadedEvaluators: new Map(),
    loadedWorkflows: new Map(),
  })),
}));

// The run-state store is Redis in production and is not what this file is
// about. Its writes are stubbed so the route's own decisions are all that
// reaches an assertion.
vi.mock("../../../services/experiment-run-state-mirror.service", () => ({
  createRunStateMirror: () => ({
    record: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  }),
}));

import { createExperimentV3RestApp } from "../experiment-v3.api";

const getWorkbenchState = vi.fn();
const recordWorkbenchRunResults = vi.fn();

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

/** What the route asked the workbench to save. */
const savedResults = (): Record<string, unknown> => {
  const [call] = recordWorkbenchRunResults.mock.calls;
  if (!call) throw new Error("the route wrote no results into the workbench state");
  return (call[0] as { results: Record<string, unknown> }).results;
};

/** Drives the route to completion, so the handler has finished when it returns. */
const execute = async (overrides: Record<string, unknown> = {}) => {
  const body = { ...executionRequest, ...overrides };
  if (body.experimentId === undefined) delete (body as { experimentId?: unknown }).experimentId;

  const response = await mount().fetch(
    new Request("http://api.test/api/experiments/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  await response.text();
  return response;
};

beforeEach(() => {
  orchestratorEvents.events = [];
  getWorkbenchState.mockReset();
  getWorkbenchState.mockResolvedValue({
    slug: "my-evaluation",
    version: 3,
    state: savedState(),
  });
  recordWorkbenchRunResults.mockReset();
  recordWorkbenchRunResults.mockResolvedValue({ version: 4 });
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

      expect(recordWorkbenchRunResults).toHaveBeenCalledTimes(1);
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
        { type: "target_result", rowIndex: 0, targetId: "target-1", output: "an answer" },
        { type: "done", summary: { total: 1, completed: 1 } },
      ];

      await execute();

      expect(recordWorkbenchRunResults).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project_1",
          id: "experiment_1",
          expectedVersion: 3,
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

      expect(recordWorkbenchRunResults).toHaveBeenCalledTimes(1);
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

      expect(recordWorkbenchRunResults).not.toHaveBeenCalled();
    });
  });

  describe("when the page names no saved experiment", () => {
    /** @scenario "A run started from a page with no saved experiment is not written back" */
    it("writes nothing into the saved state", async () => {
      orchestratorEvents.events = [
        { type: "execution_started", runId: "keen-plain-ram", total: 1 },
        { type: "target_result", rowIndex: 0, targetId: "target-1", output: "an answer" },
        { type: "done", summary: { total: 1, completed: 1 } },
      ];

      await execute({ experimentId: undefined });

      expect(recordWorkbenchRunResults).not.toHaveBeenCalled();
    });
  });
});

/** The family over a security spine that authenticates nothing. */
function mount() {
  const experimentService = { getWorkbenchState, recordWorkbenchRunResults };

  return new Hono().route(
    "/",
    createExperimentV3RestApp({
      security: passThroughSecurity(),
      ports: {
        resolveSession: async () => ({ user: { id: "user_1" } }),
        probeProjectPermission: async () => true,
        authenticateCredential: async () => ({
          ok: false,
          status: 401,
          body: { error: "no key on this door" },
        }),
        experiments: () => ({ experimentService }) as never,
        run: {
          ports: {} as never,
          progress: {} as never,
          services: {} as never,
          workflows: {} as never,
          defaultConcurrency: 1,
          startRun: async () => ({ runId: "unused", runUrl: "", total: 0 }),
        },
      },
    }),
  );
}

/** No route here is expected to throw, so a failure must be legible, not swallowed. */
const renderUnexpected: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function passThroughSecurity(): AppRestSecurity {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: renderUnexpected,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}
