/**
 * @vitest-environment node
 *
 * @see specs/experiments-v3/evaluation-execution.feature
 *
 * A run started by an open workbench tab used to exist only inside that tab:
 * `GET /api/experiments/runs/:runId` answered 404 for it, and the CLI could not
 * follow a run it had just started. The streaming route now mirrors the run
 * into the same run-state store the polling runner writes, so a browser run and
 * a CI run are readable the same way.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNNAMED_FAILURE } from "~/server/experiments-v3/execution/types";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";

wireDefaultTestApp();

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

const createRun = vi.fn().mockResolvedValue(undefined);
const addEvent = vi.fn().mockResolvedValue(undefined);
const completeRun = vi.fn().mockResolvedValue(undefined);
const stopRun = vi.fn().mockResolvedValue(undefined);
const failRun = vi.fn().mockResolvedValue(undefined);
vi.mock("~/server/experiments-v3/execution/runStateManager", () => ({
  runStateManager: {
    createRun: (...args: unknown[]) => createRun(...args),
    addEvent: (...args: unknown[]) => addEvent(...args),
    completeRun: (...args: unknown[]) => completeRun(...args),
    stopRun: (...args: unknown[]) => stopRun(...args),
    failRun: (...args: unknown[]) => failRun(...args),
    getRunState: vi.fn().mockResolvedValue(null),
  },
}));

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

const execute = async () => {
  const { app } = await import("../experiments-v3");
  const res = await app.request("/api/experiments/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(executionRequest),
  });
  // Drain the stream so the handler runs to completion before we assert.
  await res.text();
  return res;
};

beforeEach(() => {
  createRun.mockClear();
  addEvent.mockClear();
  completeRun.mockClear();
  stopRun.mockClear();
  failRun.mockClear();
  orchestratorEvents.events = [];
});

describe("POST /api/experiments/execute", () => {
  describe("when the run streams to a finish", () => {
    /** @scenario "A run started from the open page is readable by the run API" */
    it("registers the run, follows its progress and records the finish", async () => {
      orchestratorEvents.events = [
        { type: "execution_started", runId: "swift-bold-fox", total: 2 },
        { type: "progress", completed: 1, total: 2 },
        { type: "done", summary: { total: 2, completed: 2 } },
      ];

      const res = await execute();

      expect(res.status).toBe(200);
      expect(createRun).toHaveBeenCalledWith({
        runId: "swift-bold-fox",
        projectId: "project_1",
        experimentId: "experiment_1",
        experimentSlug: "my-evaluation",
        total: 2,
      });
      expect(addEvent).toHaveBeenCalledWith("swift-bold-fox", {
        type: "progress",
        completed: 1,
        total: 2,
      });
      expect(completeRun).toHaveBeenCalledWith("swift-bold-fox", {
        total: 2,
        completed: 2,
      });
    });
  });

  describe("when the run is stopped", () => {
    /** @scenario "A run started from the open page is readable by the run API" */
    it("records it as stopped", async () => {
      orchestratorEvents.events = [
        { type: "execution_started", runId: "calm-eager-owl", total: 2 },
        { type: "stopped", reason: "user" },
      ];

      await execute();

      expect(stopRun).toHaveBeenCalledWith("calm-eager-owl");
      expect(completeRun).not.toHaveBeenCalled();
    });
  });

  describe("when the orchestrator throws after the run is named", () => {
    /** @scenario "A run started from the open page is readable by the run API" */
    it("records the failure's code, never the thrown message", async () => {
      orchestratorEvents.events = [
        { type: "execution_started", runId: "bold-keen-elk", total: 2 },
        {
          get type(): string {
            throw new Error("postgres: connection refused at db-1.internal");
          },
        },
      ];

      await execute();

      expect(failRun).toHaveBeenCalledTimes(1);
      const failure = failRun.mock.calls[0]?.[1] as { code: string };
      expect(failure.code).toBe(UNNAMED_FAILURE);
      expect(failure.code).not.toContain("db-1.internal");
    });
  });
});
