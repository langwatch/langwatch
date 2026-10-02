/**
 * @vitest-environment node
 * The workbench's run doors over a real `ExperimentModule`, pinned to the wire
 * main published: every status, JSON body, event-stream header and frame.
 */
import { AgentOwnerOnlyError } from "@langwatch/agent-contract";
import {
  bindRestMiddleware,
  canonicalErrorResponse,
  createRestRuntime,
  projectRestFacts,
  RestHost,
} from "@langwatch/api/rest";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { ExecutionSummary, Experiment, ExperimentRun } from "@langwatch/experiment-contract";
import { NotFoundError } from "@langwatch/handled-error";
import type { SuiteApi } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { ExperimentModule, type ExperimentAppDependencies } from "../../app/experiment.app.ts";
import { experimentRunEventStreamChannels } from "../../channels/experiment-run-event-stream-channels.registry.ts";
import type { ExperimentRunStreamMessage } from "../../channels/experiment-run-event-stream.channel.ts";
import type { ExperimentRunProcessingPipeline } from "../../eventing/experiment-run-processing.pipeline.ts";
import { experimentProcessModule } from "../../experiment.module.ts";
import type { ExperimentIdLookupRepository } from "../../repositories/experiment-id-lookup.repository.ts";
import type { ExperimentRunProgressState } from "../../repositories/experiment-run-fold.repository.ts";
import { MemoryExperimentRunAbortRepository } from "../../repositories/memory/memory.experiment-run-abort.repository.ts";
import { MemoryExperimentRunFoldRepository } from "../../repositories/memory/memory.experiment-run-fold.repository.ts";
import { runRefusalsOf } from "../../rules/experiment-run-availability.rules.ts";
import type {
  ExecutionDataServices,
  ExperimentWorkflowDsl,
} from "../../services/experiment-execution-data.service.ts";
import { ExperimentFindOrCreateService } from "../../services/experiment-find-or-create.service.ts";
import { ExperimentRunCommandDispatcherService } from "../../services/experiment-run-command-dispatcher.service.ts";
import type { WorkflowEvaluationService } from "../../services/experiment-workflow-evaluation.service.ts";
import type { ExperimentService } from "../../services/experiment.service.ts";
import {
  experimentV3LegacyRest,
  experimentWorkbenchRunLegacyRest,
} from "../experiment-v3-legacy.rest.ts";
import { experimentV3Rest, experimentWorkbenchCredential } from "../experiment-v3.rest.ts";
import { experimentWorkbenchRunRest } from "../experiment-workbench-run.rest.ts";
import { experimentRestCredential } from "../experiment.rest.ts";

const PROJECT = "project-1";

const doneSummary = (runId: string): ExecutionSummary => ({
  runId,
  totalCells: 0,
  completedCells: 0,
  failedCells: 0,
  duration: 1,
  timestamps: { startedAt: 1, finishedAt: 2 },
});

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
  /** A process with the deployment's Redis and public address; without, runs are refused. */
  redis?: boolean;
  /** The personal-agent rule a run's start is checked against; runnable unless given. */
  ownership?: Pick<SuiteApi, "assertConnectedAgentsRunnable">;
  /** What the run pipeline's worker publishes on the run's channel once a start is sent. */
  worker?: (start: { runId: string }) => ExperimentRunStreamMessage[];
  /** Whether the worker's progress fold registers a started run; it does unless told not to. */
  registers?: boolean;
  /** Runs the progress fold already holds. */
  folded?: ExperimentRunProgressState[];
};

const processServices: ExecutionDataServices = {
  datasets: createApiFixture<DatasetApi>(),
  prompts: createApiFixture<ExecutionDataServices["prompts"]>(),
  agents: createApiFixture<ExecutionDataServices["agents"]>(),
  workflows: createApiFixture<ExperimentWorkflowDsl>(),
  entitlements: { requestBound: async () => 10_000 },
  projects: { getOrganizationId: async () => "organization-1" },
};

/** The run pipeline as the api process holds it: its senders, folds, stop signal and channel. */
function runPipeline({
  worker,
  redis,
  ownership,
  registers,
}: Required<Pick<Harness, "worker" | "redis" | "ownership" | "registers">>) {
  const folds = MemoryExperimentRunFoldRepository.create();
  // The worker folding a run's start, or its refusal, onto the key a poll reads.
  const register = async (run: { tenantId: string; runId: string; experimentId: string }) => {
    if (!registers) return;
    await folds.writeProgress({
      state: folded({ ...run, projectId: run.tenantId, status: "running", progress: 0 }),
    });
  };
  const stream = experimentRunEventStreamChannels.memory.create();
  const commands = ExperimentRunCommandDispatcherService.create();
  const sent: { starts: unknown[]; completions: unknown[]; aborts: unknown[] } = {
    starts: [],
    completions: [],
    aborts: [],
  };
  commands.connect({
    startExperimentRun: {
      send: async (start: { tenantId: string; runId: string; experimentId: string }) => {
        sent.starts.push(start);
        await register(start);
        for (const message of worker(start))
          await stream.publish({ runId: start.runId, ...message });
      },
    },
    completeExperimentRun: {
      send: async (completion: { tenantId: string; runId: string; experimentId: string }) => {
        sent.completions.push(completion);
        await register(completion);
      },
    },
    abortExperimentRun: { send: async (abort: unknown) => sent.aborts.push(abort) },
  });
  const abort = MemoryExperimentRunAbortRepository.create();
  return {
    sent,
    folds,
    abort,
    runProcessing: {
      pipeline: createApiFixture<ExperimentRunProcessingPipeline>({}, "pipeline"),
      commands,
      idLookup: createApiFixture<ExperimentIdLookupRepository>({}, "idLookup"),
      stream,
      folds,
      abort,
      publicBaseUrl: "https://app.test",
      services: processServices,
      ownership,
      concurrency: 10,
      refusals: redis
        ? {}
        : runRefusalsOf({
            sharedStore: false,
            publicBaseUrl: undefined,
            processName: "langwatch-test",
          }),
    },
  };
}

async function harness({
  experiments = {},
  redis = false,
  ownership = runnable,
  worker = () => [],
  registers = true,
  folded: held = [],
}: Harness = {}) {
  const pipeline = runPipeline({ worker, redis, ownership, registers });
  for (const state of held) await pipeline.folds.writeProgress({ state });
  const experimentService = createApiFixture<ExperimentService>(experiments, "ExperimentService");
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
    workbenchTargetNames: async () => ({}),
    workbenchObserver: { recordExperimentRan: vi.fn(), reportError: vi.fn() },
    workflowEvaluations: createApiFixture<WorkflowEvaluationService>({}, "workflowEvaluations"),
    runProcessing: pipeline.runProcessing,
  };
  const app = ExperimentModule.createForTesting(dependencies);

  const identity = {
    identify: () => ({ actor: { type: "user" as const, id: "user-1" }, scope: null }),
    authenticate: () => ({
      actor: { type: "user" as const, id: "user-1" },
      scope: { tier: "project" as const, id: PROJECT },
    }),
    authorize: () => ({ permitted: true, organizationRole: null }),
  };
  const runtime = createRestRuntime({ identity });
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
  // Every REST family the module declares, mounted in its declared order on the host.
  const host = RestHost.create({
    identities: {
      project: identity,
      organization: identity,
      api_key: identity,
      scim_token: identity,
      instance_admin: identity,
      browser: identity,
    },
    bearers: () => identity,
    audit: { record: async () => {} },
  });
  for (const transport of experimentProcessModule.transports) {
    if (transport.protocol !== "rest") continue;
    host.mount(transport.router(), () => app, {
      facts: [
        ...keyedFacts,
        bindRestMiddleware(experimentRestCredential, () => ({
          kind: "apiKey" as const,
          userId: "user-1",
        })),
      ],
    });
  }

  return {
    ...pipeline.sent,
    abort: pipeline.abort,
    folds: pipeline.folds,
    request: (path: string, init?: RequestInit) =>
      keyed.fetch(new Request(`http://api.test/api/experiments${path}`, init)),
    mounted: (path: string) =>
      host.app.fetch(new Request(`http://api.test/api/experiments${path}`)),
    legacy: (path: string, init?: RequestInit) =>
      legacyKeyed.fetch(new Request(`http://api.test/api/evaluations/v3${path}`, init)),
    execute: (body: unknown) => browser.fetch(executeRequest("/api/experiments", body)),
    legacyExecute: (body: unknown) =>
      legacyBrowser.fetch(executeRequest("/api/evaluations/v3", body)),
    abortRun: (body: unknown) =>
      browser.fetch(
        new Request("http://api.test/api/experiments/abort", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
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

/** A run as the progress fold holds it, main's poller JSON first. */
const folded = (
  overrides: Partial<ExperimentRunProgressState> & Pick<ExperimentRunProgressState, "status">,
): ExperimentRunProgressState => ({
  runId: "run-1",
  projectId: PROJECT,
  experimentId: "experiment-1",
  experimentSlug: "checkout-eval",
  progress: 1,
  total: 2,
  startedAt: 10,
  recentEvents: [],
  seq: 0,
  failed: 0,
  persistResults: false,
  resultFrames: {},
  planned: true,
  phaseOneCells: 2,
  evaluators: {},
  finishedCells: "",
  targetOutputs: {},
  traceIds: {},
  evaluatorScores: {},
  CreatedAt: 0,
  UpdatedAt: 0,
  LastEventOccurredAt: 0,
  ...overrides,
});

/** An ownership rule that lets every run start. */
const runnable: Pick<SuiteApi, "assertConnectedAgentsRunnable"> = {
  assertConnectedAgentsRunnable: async () => undefined,
};

/** An ownership rule that refuses someone else's personal development agent. */
const refusedOwnership = (): Pick<SuiteApi, "assertConnectedAgentsRunnable"> => ({
  assertConnectedAgentsRunnable: async () => {
    throw new AgentOwnerOnlyError({
      agentId: "agent-1",
      agentName: "Laptop agent",
      ownerUserId: "user-2",
      ownerName: "Someone else",
    });
  },
});

describe("POST /api/experiments/:slug/run", () => {
  const found = (state: Experiment["workbenchState"]) => ({
    findBySlugAndType: vi.fn(async () => savedExperiment(state)),
  });

  describe("when no experiment answers to the slug", () => {
    /** @scenario "Evaluation not found returns 404" */
    it("answers 404 with the handled refusal", async () => {
      const { request } = await harness({ experiments: { findBySlugAndType: async () => null } });

      const response = await request("/checkout-eval/run", runOf(""));

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "experiment_not_found" });
    });
  });

  describe("when the saved setup has no dataset", () => {
    it("refuses 400 as an invalid evaluation input", async () => {
      const { request } = await harness({ experiments: found(savedState([])) });

      const response = await request("/checkout-eval/run", runOf(""));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "experiment_evaluation_input_invalid" });
    });
  });

  describe("when the body is not JSON", () => {
    it("refuses 400 as an invalid evaluation input", async () => {
      const { request } = await harness({ experiments: found(savedState()) });

      const response = await request("/checkout-eval/run", runOf("{not json"));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "experiment_evaluation_input_invalid" });
    });
  });

  describe("when the body fails the run inputs", () => {
    it("refuses 400 as an invalid evaluation input", async () => {
      const { request } = await harness({ experiments: found(savedState()) });

      const response = await request("/checkout-eval/run", runOf('{"row_indices":"all"}'));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "experiment_evaluation_input_invalid" });
    });
  });

  describe("when the caller asks for JSON", () => {
    /** @scenario "A polled saved run starts on the run's pipeline and answers at once" */
    /** @scenario "Default response returns runId for polling" */
    it("starts the run on its pipeline and answers main's body with its id, total and link", async () => {
      const { request, starts } = await harness({
        experiments: found(savedState()),
        redis: true,
      });

      const response = await request("/checkout-eval/run", runOf(""));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");
      const body = await response.json();
      expect(body).toEqual({
        runId: expect.any(String),
        status: "running",
        total: 0,
        runUrl: `https://app.test/acme/experiments/checkout-eval?runId=${body.runId}`,
      });
      expect(starts).toMatchObject([
        {
          tenantId: PROJECT,
          runId: body.runId,
          experimentId: "experiment-1",
          plan: {
            origin: "saved",
            persistResults: true,
            actor: { userId: "user-1", label: "api" },
            experimentSlug: "checkout-eval",
            runUrl: body.runUrl,
          },
        },
      ]);
    });

    /** @scenario "A polled saved run against someone else's personal agent is stored failed" */
    it("answers started, sends no start, and completes the run failed with the refusal", async () => {
      const { request, starts, completions } = await harness({
        experiments: found(savedState()),
        redis: true,
        ownership: refusedOwnership(),
      });

      const response = await request("/checkout-eval/run", runOf(""));

      expect(response.status).toBe(200);
      const { runId } = await response.json();
      expect(starts).toEqual([]);
      expect(completions).toMatchObject([
        {
          tenantId: PROJECT,
          runId,
          outcome: "failed",
          total: 0,
          error: { code: "agent_owner_only" },
        },
      ]);
    });

    /** @scenario "A polled saved run answers as soon as its start command is written" */
    it("answers at once, and a poll before the worker folds the run reads main's started body", async () => {
      const { request, starts } = await harness({
        experiments: { ...found(savedState()), isActive: async () => true },
        redis: true,
        registers: false,
      });

      const response = await request("/checkout-eval/run", runOf(""));

      expect(response.status).toBe(200);
      const { runId } = await response.json();
      expect(starts).toHaveLength(1);
      const poll = await request(`/runs/${runId}`);
      expect(poll.status).toBe(200);
      expect(await poll.json()).toEqual({
        runId,
        status: "running",
        progress: 0,
        total: 0,
        startedAt: expect.any(Number),
      });
    });

    /** @scenario "A started run the worker has since folded is polled from its fold" */
    it("polls the fold once the worker has folded the run", async () => {
      const { request, folds } = await harness({
        experiments: { ...found(savedState()), isActive: async () => true },
        redis: true,
        registers: false,
      });

      const { runId } = await (await request("/checkout-eval/run", runOf(""))).json();
      await folds.writeProgress({ state: folded({ runId, status: "running", progress: 1 }) });
      const poll = await request(`/runs/${runId}`);

      expect(await poll.json()).toMatchObject({ runId, status: "running", progress: 1, total: 2 });
    });

    it("refuses with the run-loop refusal where no run loop was composed", async () => {
      const { request, starts } = await harness({ experiments: found(savedState()) });

      expect((await request("/checkout-eval/run", runOf(""))).status).toBe(503);
      expect(starts).toEqual([]);
    });
  });

  describe("when the caller asks for an event stream on a process with no run loop", () => {
    it("refuses with the run-loop refusal", async () => {
      const { request } = await harness({ experiments: found(savedState()) });

      const response = await request("/checkout-eval/run", runOf("", "text/event-stream"));

      expect(response.status).toBe(503);
    });
  });

  describe("when the caller asks for an event stream", () => {
    /** @scenario "A streamed saved run starts on the run's pipeline and streams its frames" */
    it("streams the run's frames under the framework's event-stream headers until done", async () => {
      const { request, starts } = await harness({
        experiments: found(savedState()),
        redis: true,
        worker: ({ runId }) => [
          { seq: 1, frame: { type: "execution_started", runId, total: 0 } },
          { seq: 2, frame: { type: "done", summary: doneSummary(runId) } },
        ],
      });

      const response = await request("/checkout-eval/run", runOf("", "text/event-stream"));

      expect(response.status).toBe(200);
      expect(eventStreamHeaders(response)).toEqual({
        contentType: "text/event-stream",
        cacheControl: "no-cache, no-transform",
        connection: "keep-alive",
      });
      expect((await framesOf(response)).map((frame) => frame.type)).toEqual([
        "execution_started",
        "done",
      ]);
      expect(starts).toMatchObject([
        { plan: { origin: "saved", persistResults: false, experimentSlug: "checkout-eval" } },
      ]);
      expect(starts).not.toMatchObject([{ plan: { runUrl: expect.any(String) } }]);
    });
  });
});

describe("GET /api/experiments/runs", () => {
  describe("when the module mounts every experiments family", () => {
    /** @scenario "The run list is not answered as an experiment named runs" */
    /** @scenario "The runs routes keep their own handlers" */
    it("answers the run list's own 400 rather than an experiment lookup", async () => {
      const { mounted } = await harness();

      const response = await mounted("/runs");

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "experimentSlug query parameter is required",
      });
    });
  });

  describe("when no experimentSlug is given", () => {
    /** @scenario "Missing experimentSlug returns 400" */
    it("answers 400 with main's flat body", async () => {
      const { request } = await harness();

      const response = await request("/runs");

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "experimentSlug query parameter is required",
      });
    });
  });

  describe("when a page is asked for", () => {
    /** @scenario "Authenticated request returns runs for the experiment" */
    it("caps the page size, falls back on a bad page and reports more pages", async () => {
      const getRunsPageBySlug = vi.fn(async () => ({
        experiment: { id: "experiment-1", slug: "checkout-eval" },
        runs: [storedRun],
        totalHits: 450,
      }));
      const { request } = await harness({ experiments: { getRunsPageBySlug } });

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

  describe("when the experiment has no runs", () => {
    /** @scenario "Experiment without runs returns an empty list" */
    it("answers 200 with an empty list", async () => {
      const { request } = await harness({
        experiments: {
          getRunsPageBySlug: async () => ({
            experiment: { id: "experiment-2", slug: "support-bot" },
            runs: [],
            totalHits: 0,
          }),
        },
      });

      const response = await request("/runs?experimentSlug=support-bot");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        experimentSlug: "support-bot",
        runs: [],
        pagination: { totalHits: 0, hasMore: false },
      });
    });
  });

  describe("when the experiment does not exist", () => {
    /** @scenario "Unknown experiment slug returns 404" */
    it("answers 404 experiment_not_found", async () => {
      const { request } = await harness({
        experiments: {
          getRunsPageBySlug: async () => {
            throw new NotFoundError("experiment_not_found", {
              resource: "Experiment",
              id: "checkout-eval",
            });
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
  it("refuses by name where no progress store was composed", async () => {
    const { request } = await harness();

    expect((await request("/runs/run-1")).status).toBe(503);
  });

  /** @scenario "A poll answers main's poller body from the run's progress fold" */
  /** @scenario "Poll for non-existent run returns 404" */
  it("answers 404 for a run the progress fold does not hold", async () => {
    const { request } = await harness({ redis: true });

    const response = await request("/runs/run-1");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "run_not_found" });
  });

  /** @scenario "A poll answers main's poller body from the run's progress fold" */
  it("answers 404 for a run another project owns", async () => {
    const { request } = await harness({
      redis: true,
      folded: [folded({ projectId: "other", status: "running" })],
    });

    const response = await request("/runs/run-1");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "run_not_found" });
  });

  it("answers 404 for a run whose experiment was archived", async () => {
    const { request } = await harness({
      experiments: { isActive: async () => false },
      redis: true,
      folded: [folded({ status: "running" })],
    });

    expect((await request("/runs/run-1")).status).toBe(404);
  });

  /** @scenario "A poll answers main's poller body from the run's progress fold" */
  it("answers progress only while the run is going", async () => {
    const { request } = await harness({
      experiments: { isActive: async () => true },
      redis: true,
      folded: [folded({ status: "running", finishedAt: 99 })],
    });

    expect(await (await request("/runs/run-1")).json()).toEqual({
      runId: "run-1",
      status: "running",
      progress: 1,
      total: 2,
      startedAt: 10,
    });
  });

  /** @scenario "A poll answers main's poller body from the run's progress fold" */
  /** @scenario "Poll for run status when completed" */
  it("answers main's summary and the run's link once the run completed", async () => {
    const summary = { ...doneSummary("run-1"), runUrl: "https://app.test/acme/run-1" };
    const { request } = await harness({
      experiments: { isActive: async () => true },
      redis: true,
      folded: [folded({ status: "completed", finishedAt: 20, summary })],
    });

    expect(await (await request("/runs/run-1")).json()).toEqual({
      runId: "run-1",
      status: "completed",
      progress: 1,
      total: 2,
      startedAt: 10,
      finishedAt: 20,
      summary,
    });
  });

  it("answers the failure's code and trace for a failed run", async () => {
    const { request } = await harness({
      experiments: { isActive: async () => true },
      redis: true,
      folded: [
        folded({ status: "failed", finishedAt: 20, error: "boom_code", traceId: "trace-1" }),
      ],
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
    const { request } = await harness({
      experiments: { isActive: async () => true },
      redis: true,
      folded: [folded({ status: "stopped", finishedAt: 20 })],
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
  it("answers 404 when neither the fold nor the slug names an experiment", async () => {
    const { request } = await harness({ redis: true });

    const response = await request("/runs/run-1/results");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "run_not_found" });
  });

  it("resolves the experiment by slug for a run past the fold", async () => {
    const findRun = vi.fn(async () => null);
    const { request } = await harness({
      experiments: { findIdBySlug: async () => ({ id: "experiment-1", slug: "s" }), findRun },
      redis: true,
    });

    const response = await request("/runs/run-1/results?experimentSlug=s");

    expect(response.status).toBe(404);
    expect(findRun).toHaveBeenCalledWith({
      projectId: PROJECT,
      experimentId: "experiment-1",
      runId: "run-1",
    });
  });

  it("reads the run's experiment from its progress fold", async () => {
    const findRun = vi.fn(async () => ({
      experimentId: "experiment-1",
      runId: "run-1",
      projectId: PROJECT,
      dataset: [],
      evaluations: [],
      timestamps: { createdAt: 1, updatedAt: 2 },
    }));
    const { request } = await harness({
      experiments: { isActive: async () => true, findRun },
      redis: true,
      folded: [folded({ status: "completed", finishedAt: 20 })],
    });

    expect((await request("/runs/run-1/results")).status).toBe(200);
    expect(findRun).toHaveBeenCalledWith({
      projectId: PROJECT,
      experimentId: "experiment-1",
      runId: "run-1",
    });
  });
});

describe("POST /api/experiments/abort", () => {
  /** @scenario "Aborting a run reads its progress fold and refuses another project's run" */
  it("answers 404 for a run another project owns, and stops nothing", async () => {
    const { abortRun, abort, aborts } = await harness({
      redis: true,
      folded: [folded({ projectId: "other", status: "running" })],
    });

    const response = await abortRun({ projectId: PROJECT, runId: "run-1" });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "run_not_found" });
    expect(await abort.isAborted("run-1")).toBe(false);
    expect(aborts).toEqual([]);
  });

  /** @scenario "Aborting a run reads its progress fold and refuses another project's run" */
  /** @scenario "Project members can stop their own running workbench execution" */
  it("sets the run's stop flag and sends the abort under the fold's experiment", async () => {
    const { abortRun, abort, aborts } = await harness({
      redis: true,
      folded: [folded({ status: "running" })],
    });

    const response = await abortRun({ projectId: PROJECT, runId: "run-1" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      runId: "run-1",
      message: "Abort requested",
    });
    expect(await abort.isAborted("run-1")).toBe(true);
    expect(aborts).toMatchObject([
      { tenantId: PROJECT, runId: "run-1", experimentId: "experiment-1", requestedBy: "user-1" },
    ]);
  });
});

describe("a started run the worker has not folded", () => {
  const started = { runId: "run-1", experimentId: "experiment-1", total: 2, startedAt: 10 };

  /** @scenario "A started run the worker has not folded is not readable by another project" */
  it("answers run_not_found to another project's poll and abort, and stops nothing", async () => {
    const { request, abortRun, abort, aborts, folds } = await harness({
      experiments: { isActive: async () => true },
      redis: true,
    });
    await folds.recordRunStart({ start: { ...started, projectId: "other" } });

    const poll = await request("/runs/run-1");
    const stop = await abortRun({ projectId: PROJECT, runId: "run-1" });

    expect(poll.status).toBe(404);
    expect(await poll.json()).toMatchObject({ code: "run_not_found" });
    expect(stop.status).toBe(404);
    expect(await abort.isAborted("run-1")).toBe(false);
    expect(aborts).toEqual([]);
  });

  /** @scenario "A started run the worker has not folded can be aborted by its own project" */
  it("sets the run's stop flag and sends the abort under the started run's experiment", async () => {
    const { abortRun, abort, aborts, folds } = await harness({ redis: true });
    await folds.recordRunStart({ start: { ...started, projectId: PROJECT } });

    const response = await abortRun({ projectId: PROJECT, runId: "run-1" });

    expect(response.status).toBe(200);
    expect(await abort.isAborted("run-1")).toBe(true);
    expect(aborts).toMatchObject([
      { tenantId: PROJECT, runId: "run-1", experimentId: "experiment-1" },
    ]);
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

  const worker = ({ runId }: { runId: string }): ExperimentRunStreamMessage[] => [
    { seq: 1, frame: { type: "execution_started", runId, total: 0 } },
    { seq: 1, frame: { type: "execution_started", runId, total: 0 } },
    { seq: 2, frame: { type: "done", summary: doneSummary(runId) } },
    { seq: 3, frame: { type: "progress", completed: 1, total: 1 } },
  ];

  /** @scenario "A streamed workbench run subscribes to its frames, then starts on the run's pipeline" */
  it("streams the run's frames under the framework's event-stream headers until done", async () => {
    const { execute } = await harness({ redis: true, worker });

    const response = await execute(request);

    expect(response.status).toBe(200);
    expect(eventStreamHeaders(response)).toEqual({
      contentType: "text/event-stream",
      cacheControl: "no-cache, no-transform",
      connection: "keep-alive",
    });
    expect((await framesOf(response)).map((frame) => frame.type)).toEqual([
      "execution_started",
      "done",
    ]);
  });

  /** @scenario "A streamed workbench run subscribes to its frames, then starts on the run's pipeline" */
  /** @scenario "Browser execution authenticates by user session" */
  it("starts the run with its plan, credited to the person who started it", async () => {
    const { execute, starts } = await harness({ redis: true, worker });

    await (await execute(request)).text();

    expect(starts).toMatchObject([
      {
        tenantId: PROJECT,
        experimentId: "experiment-1",
        total: 0,
        plan: { origin: "workbench", actor: { userId: "user-1", label: "user" }, cells: [] },
      },
    ]);
  });

  describe("when the page starts a run", () => {
    const workerDone = ({ runId }: { runId: string }): ExperimentRunStreamMessage[] => [
      { seq: 1, frame: { type: "execution_started", runId, total: 0 } },
      { seq: 2, frame: { type: "done", summary: doneSummary(runId) } },
    ];

    it("writes the cells back when it runs the saved dataset untouched", async () => {
      const { execute, starts } = await harness({ redis: true, worker: workerDone });

      await (await execute(request)).text();

      expect(starts).toMatchObject([{ plan: { persistResults: true } }]);
    });

    /** @scenario "A run started from the open page with its own rows is not written back" */
    it("writes nothing back when the request carries its own rows", async () => {
      const { execute, starts } = await harness({ redis: true, worker: workerDone });

      await (await execute({ ...request, data: [{ input: "hello" }] })).text();

      expect(starts).toMatchObject([{ plan: { persistResults: false } }]);
    });

    /** @scenario "A run started from a page with no saved experiment is not written back" */
    it("writes nothing back when the page names no experiment", async () => {
      const { execute, starts } = await harness({ redis: true, worker: workerDone });

      await (await execute({ ...request, experimentId: undefined })).text();

      expect(starts).toMatchObject([{ plan: { persistResults: false } }]);
    });
  });

  /** @scenario "A workbench run against someone else's personal agent streams its refusal and starts nothing" */
  it("streams the ownership refusal as main's error frame and sends no start", async () => {
    const refused = refusedOwnership();
    const { execute, starts } = await harness({ redis: true, ownership: refused, worker });

    const frames = await framesOf(await execute(request));

    expect(frames).toMatchObject([{ type: "error", message: "agent_owner_only" }]);
    expect(starts).toEqual([]);
  });

  /** @scenario "A streamed run passes a cell's start through without deduplicating it" */
  it("passes a cell's start through, though it repeats the last folded seq", async () => {
    const { execute } = await harness({
      redis: true,
      worker: ({ runId }) => [
        { seq: 1, frame: { type: "execution_started", runId, total: 1 } },
        { seq: 1, frame: { type: "cell_started", rowIndex: 0, targetId: "target-1" } },
        { seq: 1, frame: { type: "execution_started", runId, total: 1 } },
        { seq: 2, frame: { type: "done", summary: doneSummary(runId) } },
      ],
    });

    expect((await framesOf(await execute(request))).map((frame) => frame.type)).toEqual([
      "execution_started",
      "cell_started",
      "done",
    ]);
  });

  it("refuses with the run-loop refusal where no run loop was composed", async () => {
    const { execute } = await harness();

    expect((await execute(request)).status).toBe(503);
  });
});

describe("/api/evaluations/v3/*, the SDKs' older name for the workbench doors", () => {
  type Answer = { status: number; contentType: string | null; body: string };
  /** The answer with its generated run id masked, so two starts compare alike. */
  const answerOf = async (response: Response): Promise<Answer> => {
    const body = await response.text();
    const runId = /"runId":"([^"]+)"/.exec(body)?.[1];
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      body: runId ? body.replaceAll(runId, "<run>") : body,
    };
  };
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
    redis: true,
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
    ["results nothing names", { redis: true }, "/runs/r/results", undefined, 404],
    ["a setup read", setup, "/checkout-eval/workbench-state?fields=version", undefined, 200],
    ["a setup save", setup, "/checkout-eval/workbench-state", save, 200],
    ["a version page", setup, "/checkout-eval/versions?limit=5", undefined, 200],
  ] as const)(
    "answers %s with the canonical status and body",
    async (_case, options, path, init, status) => {
      const canonical = await answerOf(await (await harness(options)).request(path, init?.()));
      const alias = await answerOf(await (await harness(options)).legacy(path, init?.()));

      expect(alias.status).toBe(status);
      expect(alias).toEqual(canonical);
    },
  );

  /** @scenario "The evaluations v3 alias answers what the experiments run doors answer" */
  it("answers a started run with main's body at the alias path", async () => {
    const { legacy, starts } = await harness(setup);

    const response = await legacy("/checkout-eval/run", runOf(""));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      runId: expect.any(String),
      status: "running",
      total: 0,
      runUrl: `https://app.test/acme/experiments/checkout-eval?runId=${body.runId}`,
    });
    expect(starts).toHaveLength(1);
  });

  /** @scenario "The evaluations v3 alias answers what the experiments run doors answer" */
  it("refuses a browser execute at the alias as the canonical door does", async () => {
    const body = { projectId: PROJECT, experimentId: "experiment-1", name: "Checkout eval" };
    const canonical = await answerOf(await (await harness()).execute(body));
    const alias = await answerOf(await (await harness()).legacyExecute(body));

    expect(alias).toEqual(canonical);
  });
});
