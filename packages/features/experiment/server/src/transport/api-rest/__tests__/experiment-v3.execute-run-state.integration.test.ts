/**
 * @see specs/experiments-v3/evaluation-execution.feature
 *
 * A run started by an open workbench tab used to exist only inside that tab:
 * `GET /api/experiments/runs/:runId` answered 404 for it, and the CLI could not
 * follow a run it had just started. The streaming route mirrors the run into
 * the same run-state store the polling runner writes, so a browser run and a
 * CI run are readable the same way. This exercises the real
 * `createRunStateMirror`, wired to a fake `progress` port, rather than
 * stubbing the mirror away.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { UNNAMED_FAILURE } from "@langwatch/experiment-contract";
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

vi.mock("../../../services/experiment-run-results-writer.service", () => ({
  runResultsWriterFor: () => undefined,
}));

import { createExperimentV3RestApp } from "../experiment-v3.api";

const createRun = vi.fn().mockResolvedValue(undefined);
const addEvent = vi.fn().mockResolvedValue(undefined);
const completeRun = vi.fn().mockResolvedValue(undefined);
const stopRun = vi.fn().mockResolvedValue(undefined);
const failRun = vi.fn().mockResolvedValue(undefined);
const tryGetRunState = vi.fn().mockResolvedValue(null);

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

const post = async () =>
  mount().fetch(
    new Request("http://api.test/api/experiments/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(executionRequest),
    }),
  );

const execute = async () => {
  const res = await post();
  // Drain the stream so the handler runs to completion before we assert.
  await res.text();
  return res;
};

/** Whether a promise settles inside a window, without waiting on it further. */
const settlesWithin = ({
  work,
  ms,
}: {
  work: Promise<unknown>;
  ms: number;
}): Promise<"released" | "nothing yet"> =>
  Promise.race([
    work.then(() => "released" as const),
    new Promise<"nothing yet">((resolve) => setTimeout(() => resolve("nothing yet"), ms)),
  ]);

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

  describe("when the store write that opens the run is still in flight", () => {
    /** @scenario "The run id is not given out before the run API can answer for it" */
    it("holds the frame that names the run until the run API can answer for it", async () => {
      orchestratorEvents.events = [
        { type: "execution_started", runId: "quick-plain-doe", total: 1 },
        { type: "done", summary: { total: 1, completed: 1 } },
      ];

      let openTheRun = (): void => undefined;
      createRun.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            openTheRun = () => resolve();
          }),
      );

      const res = await post();
      const reader = res.body?.getReader();
      if (!reader) throw new Error("the response carries no stream");
      const frame = reader.read();

      // The page reads the id off this frame, calls onRunStarted and may poll
      // at once. Releasing the frame first makes that poll read 404 on a
      // healthy run, and a caller takes 404 for a run that never existed.
      expect(await settlesWithin({ work: frame, ms: 100 })).toBe("nothing yet");

      openTheRun();
      expect(new TextDecoder().decode((await frame).value)).toContain("quick-plain-doe");
      await reader.cancel();
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

  describe("when the orchestrator throws after the run has reported it finished", () => {
    /** @scenario "A run started from the open page is readable by the run API" */
    it("leaves the finished run finished, rather than rewriting it as failed", async () => {
      orchestratorEvents.events = [
        { type: "execution_started", runId: "keen-plain-ram", total: 1 },
        { type: "done", summary: { total: 1, completed: 1 } },
        {
          get type(): string {
            throw new Error("the stream tore down after the last frame");
          },
        },
      ];

      await execute();

      expect(completeRun).toHaveBeenCalledWith("keen-plain-ram", {
        total: 1,
        completed: 1,
      });
      // A poller that already read "done" must not read "failed" next.
      expect(failRun).not.toHaveBeenCalled();
    });
  });
});

/** The family over a security spine that authenticates nothing. */
function mount() {
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
        experiments: () => ({}) as never,
        run: {
          ports: {} as never,
          progress: {
            createRun,
            addEvent,
            completeRun,
            stopRun,
            failRun,
            tryGetRunState,
          } as never,
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
