/**
 * @vitest-environment node
 * The workbench's run doors over a real `ExperimentApp`, pinned to the wire
 * main published: every status, JSON body, event-stream header and frame.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  bindRestMiddleware,
  canonicalErrorResponse,
  createRestRuntime,
  projectRestFacts,
} from "@langwatch/api/rest";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { Experiment, ExperimentRun } from "@langwatch/experiment-contract";
import { NotFoundError } from "@langwatch/handled-error";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import type { ExperimentV3RunLoop } from "../../app/experiment-workbench.members.ts";
import { ExperimentApp, type ExperimentAppDependencies } from "../../app/experiment.app.ts";
import type {
  ExperimentRunProgressRepository,
  ExperimentRunProgressState,
} from "../../repositories/experiment-run-progress.repository.ts";
import type { ExperimentRunCollaborators } from "../../rules/experiment-run-input.rules.ts";
import type { ExperimentWorkflowDsl } from "../../services/experiment-execution-data.service.ts";
import { ExperimentFindOrCreateService } from "../../services/experiment-find-or-create.service.ts";
import type { WorkflowEvaluationService } from "../../services/experiment-workflow-evaluation.service.ts";
import type { ExperimentService } from "../../services/experiment.service.ts";
import {
  experimentV3LegacyRest,
  experimentWorkbenchRunLegacyRest,
} from "../experiment-v3-legacy.rest.ts";
import { experimentV3Rest, experimentWorkbenchCredential } from "../experiment-v3.rest.ts";
import { experimentWorkbenchRunRest } from "../experiment-workbench-run.rest.ts";

const PROJECT = "project-1";

const inlineDataset = {
  id: "dataset-1",
  name: "Inline",
  type: "inline" as const,
  columns: [{ id: "input", name: "input", type: "string" as const }],
  inline: {
    columns: [{ id: "input", name: "input", type: "string" as const }],
    records: { input: ["hello"] },
  },
};

const savedState = (datasets: (typeof inlineDataset)[] = [inlineDataset]) => ({
  name: "Checkout eval",
  datasets,
  activeDatasetId: "dataset-1",
  evaluators: [],
  targets: [],
});

const savedExperiment = (workbenchState: Experiment["workbenchState"]): Experiment => ({
  id: "experiment-1",
  projectId: PROJECT,
  slug: "checkout-eval",
  name: "Checkout eval",
  type: "EVALUATIONS_V3",
  workflowId: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  archivedAt: null,
  workbenchState,
  workbenchVersion: 1,
});

const storedRun: ExperimentRun = {
  experimentId: "experiment-1",
  runId: "run-1",
  workflowVersion: null,
  timestamps: { createdAt: 1, updatedAt: 2 },
  summary: { evaluations: {} },
};

type Harness = {
  experiments?: Partial<ExperimentService>;
  progress?: Partial<ExperimentRunProgressRepository> | null;
  ports?: ExperimentRunCollaborators | null;
};

function harness({ experiments = {}, progress = null, ports = null }: Harness = {}) {
  const experimentService = createApiFixture<ExperimentService>(experiments, "ExperimentService");
  const startRun = vi.fn(async () => ({
    runId: "run-9",
    runUrl: "https://app.test/run-9",
    total: 1,
  }));
  const runLoop: ExperimentV3RunLoop = {
    ports,
    progress:
      progress === null
        ? null
        : createApiFixture<ExperimentRunProgressRepository>(progress, "progress"),
    services: {
      datasets: createApiFixture<DatasetApi>(),
      prompts: createApiFixture(),
      agents: createApiFixture(),
      workflows: createApiFixture<ExperimentWorkflowDsl>(),
      entitlements: { requestBound: async () => 10_000 },
      projects: { getOrganizationId: async () => "organization-1" },
    },
    workflows: createApiFixture<WorkflowApi>(),
    defaultConcurrency: 10,
    startRun,
  };
  const dependencies: ExperimentAppDependencies = {
    experiments: experimentService,
    runLookup: ExperimentFindOrCreateService.create(experimentService),
    workflows: createApiFixture<WorkflowApi>(),
    workflowAuthoring: createApiFixture(),
    dataset: createApiFixture<DatasetApi>(),
    monitors: createApiFixture(),
    broadcast: createApiFixture(),
    permissions: createApiFixture(),
    people: createApiFixture(),
    modelCosts: createApiFixture(),
    slugify: (value) => value,
    runLoop,
    workbenchObserver: { recordExperimentRan: vi.fn(), reportError: vi.fn() },
    workflowEvaluations: createApiFixture<WorkflowEvaluationService>({}, "workflowEvaluations"),
  };
  const app = ExperimentApp.createForTesting(dependencies);

  const runtime = createRestRuntime({
    identity: {
      identify: () => ({ actor: { type: "user" as const, id: "user-1" }, scope: null }),
      authenticate: () => ({
        actor: { type: "user" as const, id: "user-1" },
        scope: { tier: "project" as const, id: PROJECT },
      }),
      authorize: () => ({ permitted: true, organizationRole: null }),
    },
  });
  const keyedFacts = [
    bindRestMiddleware(projectRestFacts, () => ({
      projectSlug: "acme",
      viewerUserId: "user-1",
      actorId: "user-1",
    })),
    bindRestMiddleware(experimentWorkbenchCredential, () => ({
      kind: "apiKey" as const,
      userId: "user-1",
    })),
  ];
  const keyedFamily = (family: typeof experimentV3Rest) =>
    runtime.mount(family.router(), {
      app: () => app,
      credential: "project",
      onError: canonicalErrorResponse,
      facts: keyedFacts,
    });
  const browserFamily = (family: typeof experimentWorkbenchRunRest) =>
    runtime.mount(family.router(), { app: () => app, onError: canonicalErrorResponse });
  const keyed = keyedFamily(experimentV3Rest);
  const browser = browserFamily(experimentWorkbenchRunRest);
  const legacyKeyed = keyedFamily(experimentV3LegacyRest);
  const legacyBrowser = browserFamily(experimentWorkbenchRunLegacyRest);

  return {
    startRun,
    request: (path: string, init?: RequestInit) =>
      keyed.fetch(new Request(`http://api.test/api/experiments${path}`, init)),
    legacy: (path: string, init?: RequestInit) =>
      legacyKeyed.fetch(new Request(`http://api.test/api/evaluations/v3${path}`, init)),
    execute: (body: unknown) => browser.fetch(executeRequest("/api/experiments", body)),
    legacyExecute: (body: unknown) =>
      legacyBrowser.fetch(executeRequest("/api/evaluations/v3", body)),
  };
}

const executeRequest = (base: string, body: unknown) =>
  new Request(`http://api.test${base}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const runOf = (body: string, accept?: string): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(accept ? { accept } : {}) },
  body,
});

/** Each `data:` frame of an event stream, parsed. */
async function framesOf(response: Response): Promise<{ type: string }[]> {
  const text = await response.text();

  return text
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice("data: ".length)) as { type: string });
}

const eventStreamHeaders = (response: Response) => ({
  contentType: response.headers.get("content-type"),
  cacheControl: response.headers.get("cache-control"),
  connection: response.headers.get("connection"),
});

describe("POST /api/experiments/:slug/run", () => {
  const found = (state: Experiment["workbenchState"]) => ({
    findBySlugAndType: vi.fn(async () => savedExperiment(state)),
  });

  describe("when no experiment answers to the slug", () => {
    it("answers 404 with the handled refusal", async () => {
      const { request } = harness({ experiments: { findBySlugAndType: async () => null } });

      const response = await request("/checkout-eval/run", runOf(""));

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "experiment_not_found" });
    });
  });

  describe("when the saved setup has no dataset", () => {
    it("answers 400 with main's flat body", async () => {
      const { request } = harness({ experiments: found(savedState([])) });

      const response = await request("/checkout-eval/run", runOf(""));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "No dataset configured" });
    });
  });

  describe("when the body is not JSON", () => {
    it("answers 400 with main's flat body", async () => {
      const { request } = harness({ experiments: found(savedState()) });

      const response = await request("/checkout-eval/run", runOf("{not json"));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid JSON body" });
    });
  });

  describe("when the body fails the run inputs", () => {
    it("answers 400 with the first issue as the flat error", async () => {
      const { request } = harness({ experiments: found(savedState()) });

      const response = await request("/checkout-eval/run", runOf('{"row_indices":"all"}'));
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(Object.keys(body)).toEqual(["error"]);
      expect(typeof body.error).toBe("string");
    });
  });

  describe("when the caller asks for JSON", () => {
    it("starts a polled run and answers its id", async () => {
      const { request, startRun } = harness({ experiments: found(savedState()) });

      const response = await request("/checkout-eval/run", runOf(""));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(await response.json()).toEqual({
        runId: "run-9",
        status: "running",
        total: 1,
        runUrl: "https://app.test/run-9",
      });
      expect(startRun).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the caller asks for an event stream on a process with no run loop", () => {
    it("refuses with the run-loop refusal", async () => {
      const { request } = harness({ experiments: found(savedState()) });

      const response = await request("/checkout-eval/run", runOf("", "text/event-stream"));

      expect(response.status).toBe(503);
    });
  });

  describe("when the caller asks for an event stream", () => {
    it("streams data frames under main's event-stream headers", async () => {
      const { request, startRun } = harness({
        experiments: found(savedState()),
        ports: createApiFixture<ExperimentRunCollaborators>(),
        progress: {},
      });

      const response = await request("/checkout-eval/run", runOf("", "text/event-stream"));

      expect(response.status).toBe(200);
      expect(eventStreamHeaders(response)).toEqual({
        contentType: "text/event-stream",
        cacheControl: "no-cache",
        connection: "keep-alive",
      });
      expect(await framesOf(response)).toMatchInlineSnapshot(`
        [
          {
            "message": "lw.unnamed_failure",
            "type": "error",
          },
        ]
      `);
      expect(startRun).not.toHaveBeenCalled();
    });
  });
});

describe("GET /api/experiments/runs", () => {
  describe("when no experimentSlug is given", () => {
    it("answers 400 with main's flat body", async () => {
      const { request } = harness();

      const response = await request("/runs");

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "experimentSlug query parameter is required",
      });
    });
  });

  describe("when a page is asked for", () => {
    it("caps the page size, falls back on a bad page and reports more pages", async () => {
      const getRunsPageBySlug = vi.fn(async () => ({
        experiment: { id: "experiment-1", slug: "checkout-eval" },
        runs: [storedRun],
        totalHits: 450,
      }));
      const { request } = harness({ experiments: { getRunsPageBySlug } });

      const response = await request("/runs?experimentSlug=checkout-eval&pageSize=999&page=x");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        experimentId: "experiment-1",
        experimentSlug: "checkout-eval",
        runs: [storedRun],
        pagination: { page: 1, pageSize: 200, totalHits: 450, hasMore: true },
      });
      expect(getRunsPageBySlug).toHaveBeenCalledWith({
        projectId: PROJECT,
        experimentSlug: "checkout-eval",
        page: 1,
        pageSize: 200,
      });
    });
  });

  describe("when the experiment does not exist", () => {
    it("answers 404 experiment_not_found", async () => {
      const { request } = harness({
        experiments: {
          getRunsPageBySlug: async () => {
            throw new NotFoundError("experiment_not_found", "Experiment", "checkout-eval");
          },
        },
      });

      const response = await request("/runs?experimentSlug=checkout-eval");

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "experiment_not_found" });
    });
  });
});

describe("GET /api/experiments/runs/:runId", () => {
  const state = (
    overrides: Partial<ExperimentRunProgressState> & Pick<ExperimentRunProgressState, "status">,
  ): ExperimentRunProgressState => ({
    runId: "run-1",
    projectId: PROJECT,
    experimentId: "experiment-1",
    experimentSlug: "checkout-eval",
    progress: 1,
    total: 2,
    startedAt: 10,
    ...overrides,
  });

  it("refuses by name where no progress store was composed", async () => {
    const { request } = harness();

    expect((await request("/runs/run-1")).status).toBe(503);
  });

  it("answers 404 for a run another project owns", async () => {
    const { request } = harness({
      progress: { findRunState: async () => state({ projectId: "other", status: "running" }) },
    });

    const response = await request("/runs/run-1");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "run_not_found" });
  });

  it("answers 404 for a run whose experiment was archived", async () => {
    const { request } = harness({
      experiments: { isActive: async () => false },
      progress: { findRunState: async () => state({ status: "running" }) },
    });

    expect((await request("/runs/run-1")).status).toBe(404);
  });

  it("answers progress only while the run is going", async () => {
    const { request } = harness({
      experiments: { isActive: async () => true },
      progress: { findRunState: async () => state({ status: "running", finishedAt: 99 }) },
    });

    expect(await (await request("/runs/run-1")).json()).toEqual({
      runId: "run-1",
      status: "running",
      progress: 1,
      total: 2,
      startedAt: 10,
    });
  });

  it("answers the failure's code and trace for a failed run", async () => {
    const { request } = harness({
      experiments: { isActive: async () => true },
      progress: {
        findRunState: async () =>
          state({ status: "failed", finishedAt: 20, error: "boom_code", traceId: "trace-1" }),
      },
    });

    expect(await (await request("/runs/run-1")).json()).toEqual({
      runId: "run-1",
      status: "failed",
      progress: 1,
      total: 2,
      startedAt: 10,
      finishedAt: 20,
      error: "boom_code",
      traceId: "trace-1",
    });
  });

  it("answers finishedAt without a summary for a stopped run", async () => {
    const { request } = harness({
      experiments: { isActive: async () => true },
      progress: {
        findRunState: async () => state({ status: "stopped", finishedAt: 20 }),
      },
    });

    expect(await (await request("/runs/run-1")).json()).toEqual({
      runId: "run-1",
      status: "stopped",
      progress: 1,
      total: 2,
      startedAt: 10,
      finishedAt: 20,
    });
  });
});

describe("GET /api/experiments/runs/:runId/results", () => {
  it("answers 404 when neither the cache nor the slug names an experiment", async () => {
    const { request } = harness({ progress: { findRunState: async () => null } });

    const response = await request("/runs/run-1/results");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "run_not_found" });
  });

  it("resolves the experiment by slug for a run past the cache", async () => {
    const findRun = vi.fn(async () => null);
    const { request } = harness({
      experiments: { findIdBySlug: async () => ({ id: "experiment-1", slug: "s" }), findRun },
      progress: { findRunState: async () => null },
    });

    const response = await request("/runs/run-1/results?experimentSlug=s");

    expect(response.status).toBe(404);
    expect(findRun).toHaveBeenCalledWith({
      projectId: PROJECT,
      experimentId: "experiment-1",
      runId: "run-1",
    });
  });
});

describe("POST /api/experiments/execute", () => {
  const request = {
    projectId: PROJECT,
    experimentId: "experiment-1",
    name: "Checkout eval",
    dataset: inlineDataset,
    targets: [],
    evaluators: [],
    scope: { type: "full" },
  };

  it("streams data frames under main's event-stream headers", async () => {
    const { execute } = harness({
      ports: createApiFixture<ExperimentRunCollaborators>(),
      progress: {},
    });

    const response = await execute(request);

    expect(response.status).toBe(200);
    expect(eventStreamHeaders(response)).toEqual({
      contentType: "text/event-stream",
      cacheControl: "no-cache",
      connection: "keep-alive",
    });
    expect(await framesOf(response)).toMatchInlineSnapshot(`
      [
        {
          "message": "lw.unnamed_failure",
          "type": "error",
        },
      ]
    `);
  });

  it("refuses with the run-loop refusal where no run loop was composed", async () => {
    const { execute } = harness();

    expect((await execute(request)).status).toBe(503);
  });
});

describe("/api/evaluations/v3/*, the SDKs' older name for the workbench doors", () => {
  type Answer = { status: number; contentType: string | null; body: string };
  const answerOf = async (response: Response): Promise<Answer> => ({
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: await response.text(),
  });
  const workbench = {
    experimentId: "experiment-1",
    slug: "checkout-eval",
    version: 3,
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    name: "Checkout eval",
    state: savedState(),
  };
  const version = {
    version: 2,
    counterVersion: 3,
    autoSaved: false,
    commitMessage: "named",
    authorLabel: "api",
    authorId: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-02T00:00:00.000Z"),
  };
  const setup: Harness = {
    experiments: {
      findBySlugAndType: async () => savedExperiment(savedState()),
      getWorkbenchState: async () => workbench,
      listWorkbenchVersions: async () => ({ versions: [version], nextCursor: null }),
      saveWorkbenchState: async () => ({ ...workbench, version: 4 }),
    },
  };
  const save = (): RequestInit => ({
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: savedState(), expectedVersion: 3 }),
  });

  /** @scenario "The evaluations v3 alias answers what the experiments run doors answer" */
  it.each([
    ["a started run", setup, "/checkout-eval/run", () => runOf(""), 200],
    [
      "an unknown slug",
      { experiments: { findBySlugAndType: async () => null } },
      "/nope/run",
      () => runOf(""),
      404,
    ],
    ["a run list without its slug", {}, "/runs", undefined, 400],
    ["a run with no progress store", {}, "/runs/run-1", undefined, 503],
    [
      "results nothing names",
      { progress: { findRunState: async () => null } },
      "/runs/r/results",
      undefined,
      404,
    ],
    ["a setup read", setup, "/checkout-eval/workbench-state?fields=version", undefined, 200],
    ["a setup save", setup, "/checkout-eval/workbench-state", save, 200],
    ["a version page", setup, "/checkout-eval/versions?limit=5", undefined, 200],
  ] as const)(
    "answers %s with the canonical status and body",
    async (_case, options, path, init, status) => {
      const canonical = await answerOf(await harness(options).request(path, init?.()));
      const alias = await answerOf(await harness(options).legacy(path, init?.()));

      expect(alias.status).toBe(status);
      expect(alias).toEqual(canonical);
    },
  );

  /** @scenario "The evaluations v3 alias answers what the experiments run doors answer" */
  it("answers a started run with main's body at the alias path", async () => {
    const { legacy, startRun } = harness(setup);

    const response = await legacy("/checkout-eval/run", runOf(""));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      runId: "run-9",
      status: "running",
      total: 1,
      runUrl: "https://app.test/run-9",
    });
    expect(startRun).toHaveBeenCalledTimes(1);
  });

  /** @scenario "The evaluations v3 alias answers what the experiments run doors answer" */
  it("refuses a browser execute at the alias as the canonical door does", async () => {
    const body = { projectId: PROJECT, experimentId: "experiment-1", name: "Checkout eval" };
    const canonical = await answerOf(await harness().execute(body));
    const alias = await answerOf(await harness().legacyExecute(body));

    expect(alias).toEqual(canonical);
  });
});
