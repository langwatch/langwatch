import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { DatasetApi } from "@langwatch/dataset-contract";
import { createTenantId, EventUtils } from "@langwatch/eventing";
import type { FindOrCreateWorkflowExperimentInput } from "@langwatch/experiment-contract";
import { resolveRequestBound, type RequestBoundKey } from "@langwatch/plans";
import type { PromptApi } from "@langwatch/prompt-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type {
  ExperimentRunCompletedEventData,
  ExperimentRunStartedEventData,
  WorkflowEvaluationRequestedEvent,
  WorkflowEvaluationRequestedEventData,
} from "../../eventing/experiment-run-events.process.ts";
import { ExperimentRunProgressFoldProjection } from "../../eventing/experiment-run-progress.projection.ts";
import { ExperimentRunProgressStore } from "../../eventing/experiment-run-progress.store.ts";
import { MemoryExperimentRunFoldRepository } from "../../repositories/memory/memory.experiment-run-fold.repository.ts";
import { EXPERIMENT_RUN_EVENT_TYPES } from "../../rules/experiment-run-event-types.rules.ts";
import { makeExperimentRunKey } from "../../rules/experiment-run-key.rules.ts";
import type { ExperimentWorkflowDsl } from "../experiment-execution-data.service.ts";
import { WorkflowEvaluationService } from "../experiment-workflow-evaluation.service.ts";

const PROJECT_ID = "project-1";
const PROJECT_SLUG = "project-one";
const WORKFLOW_ID = "workflow_1";

function entryDsl(inline: { question: string[] } = { question: ["a", "b", "c"] }) {
  return {
    spec_version: "1.4",
    workflow_id: WORKFLOW_ID,
    name: "Evaluate me",
    icon: "🧪",
    description: "",
    version: "1.0",
    default_llm: { model: "openai/gpt-5-mini" },
    template_adapter: "default",
    enable_tracing: true,
    state: {},
    nodes: [
      {
        id: "entry",
        type: "entry",
        position: { x: 0, y: 0 },
        data: {
          name: "Entry point",
          outputs: [{ identifier: "question", type: "str" }],
          entry_selection: "first",
          train_size: 0.8,
          test_size: 0.2,
          seed: 42,
          dataset: {
            name: "inline",
            inline: {
              records: inline,
              columnTypes: [{ name: "question", type: "string" }],
            },
          },
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 300, y: 0 },
        data: { name: "End", inputs: [{ identifier: "output", type: "str" }] },
      },
    ],
    edges: [
      {
        id: "e1",
        source: "entry",
        sourceHandle: "outputs.question",
        target: "end",
        targetHandle: "inputs.output",
        type: "default",
      },
    ],
  };
}

type FakeVersion = { id: string; version: string; dsl: unknown };
type FakeWorkflow = { id: string; name: string; archived?: boolean; versions: FakeVersion[] };
type Enveloped<Data> = Data & { tenantId: string; occurredAt: number };
type SentRequest = Enveloped<WorkflowEvaluationRequestedEventData>;

/** Version selection belongs to the source, so this one answers the last version by default. */
function buildWorkflowSource(workflows: Record<string, FakeWorkflow>): ExperimentWorkflowDsl {
  return {
    async findWorkflow(input) {
      const wf = workflows[input.workflowId];
      if (!wf || wf.archived) return null;
      return { id: wf.id, name: wf.name, publishedId: wf.versions.at(-1)?.id ?? null };
    },
    async findVersionDsl(input) {
      const wf = workflows[input.workflowId];
      return wf?.versions.find((v) => v.id === input.versionId)?.dsl ?? null;
    },
    async findEvaluableWorkflow(input) {
      const wf = workflows[input.workflowId];
      if (!wf || wf.archived) return null;
      return { id: wf.id, name: wf.name };
    },
    async findEvaluableVersion(input) {
      const wf = workflows[input.workflowId];
      if (!wf) return null;
      if (input.versionId) {
        return wf.versions.find((v) => v.id === input.versionId) ?? null;
      }
      return wf.versions.at(-1) ?? null;
    },
  };
}

/** The worker's progress fold, folding a sent request with the real projection. */
function workerFold() {
  const folds = MemoryExperimentRunFoldRepository.create();
  const store = ExperimentRunProgressStore.create({ repository: folds });
  const projection = ExperimentRunProgressFoldProjection.create({ store });
  return {
    folds,
    fold: async (request: WorkflowEvaluationRequestedEventData & { tenantId: string }) => {
      const { tenantId, ...data } = request;
      const aggregateId = makeExperimentRunKey(data.experimentId, data.runId);
      const event = EventUtils.createEvent<WorkflowEvaluationRequestedEvent>({
        aggregateType: "experiment_run",
        aggregateId,
        tenantId: createTenantId(tenantId),
        type: EXPERIMENT_RUN_EVENT_TYPES.WORKFLOW_EVALUATION_REQUESTED,
        version: "2026-09-25",
        data,
        occurredAt: 500,
      });
      const read = await store.get(aggregateId);
      const state = read.kind === "folded" ? read.state : projection.init();
      await store.store(projection.apply(state, event), {
        aggregateId,
        tenantId: createTenantId(tenantId),
      });
    },
  };
}

const persistedTargetsSchema = z.object({
  targets: z.array(
    z.object({
      inputs: z.array(z.object({ identifier: z.string() })),
      mappings: z.record(z.string(), z.record(z.string(), z.unknown())),
    }),
  ),
});

function buildService(
  overrides: {
    workflows?: Record<string, FakeWorkflow>;
    rowBound?: number;
    /** A worker that has not folded the request by the time the api answers. */
    workerIdle?: boolean;
  } = {},
) {
  const workflows =
    overrides.workflows ??
    ({
      [WORKFLOW_ID]: {
        id: WORKFLOW_ID,
        name: "Evaluate me",
        versions: [
          { id: "version_1", version: "1", dsl: entryDsl() },
          { id: "version_2", version: "2", dsl: entryDsl() },
        ],
      },
    } satisfies Record<string, FakeWorkflow>);
  const workflowSource = buildWorkflowSource(workflows);
  const experimentsAsked: FindOrCreateWorkflowExperimentInput[] = [];
  const sent: SentRequest[] = [];
  const startsSent: unknown[] = [];
  const completionsSent: unknown[] = [];
  const worker = workerFold();
  const services = {
    datasets: createApiFixture<DatasetApi>({}),
    prompts: createApiFixture<PromptApi>({}),
    agents: createApiFixture<AgentApi>({}),
    workflows: workflowSource,
    entitlements: {
      requestBound: async ({ key }: { key: RequestBoundKey }) =>
        overrides.rowBound ?? resolveRequestBound(key, "FREE"),
    },
    projects: {
      getOrganizationId: async (projectId: string) => `organization-of-${projectId}`,
    },
  };

  const service = WorkflowEvaluationService.create({
    experiments: {
      findOrCreateForWorkflow: async (input) => {
        experimentsAsked.push(input);
        return { id: "experiment_1", slug: "evaluate-me" };
      },
    },
    workflowSource,
    services,
    concurrency: 1,
    folds: worker.folds,
    refusals: {},
    requests: {
      requestWorkflowEvaluation: async (input) => {
        sent.push(input);
        if (!overrides.workerIdle) await worker.fold(input);
      },
      startExperimentRun: async (input) => {
        startsSent.push(input);
      },
      completeExperimentRun: async (input) => {
        completionsSent.push(input);
      },
    },
    baseUrl: "https://app.langwatch.test",
  });

  return {
    service,
    experimentsAsked,
    sent,
    folds: worker.folds,
    fold: worker.fold,
    starts: () => z.array(startSchema).parse(startsSent),
    completions: () => z.array(completionSchema).parse(completionsSent),
  };
}

/** What the tests read of a start the worker sent; the plan is the contract's to parse. */
const startSchema = z.custom<Enveloped<ExperimentRunStartedEventData>>(
  (value) => typeof value === "object" && value !== null && "plan" in value,
);
const completionSchema = z.custom<Enveloped<ExperimentRunCompletedEventData>>(
  (value) => typeof value === "object" && value !== null && "outcome" in value,
);

const baseInput = {
  projectId: PROJECT_ID,
  projectSlug: PROJECT_SLUG,
  workflowId: WORKFLOW_ID,
};

describe("WorkflowEvaluationService.request", () => {
  describe("given a workflow with a committed version", () => {
    /** @scenario Triggering an evaluation returns a run id and a results url */
    it("returns a run id and a results url", async () => {
      const { service } = buildService();

      const started = await service.request(baseInput);

      expect(started.runId.length).toBeGreaterThan(0);
      expect(started.runUrl).toContain("/experiments/evaluate-me");
      expect(started.runUrl).toContain(`runId=${started.runId}`);
    });

    /** @scenario The response stays backward compatible */
    it("still carries the evaluated version id and version", async () => {
      const { service } = buildService();

      const started = await service.request(baseInput);

      expect(started.workflowVersionId).toBe("version_2");
      expect(started.version).toBe("2");
    });

    /** @scenario The latest committed version is evaluated by default */
    it("evaluates the version its source answers when none is named", async () => {
      const { service, sent } = buildService();

      await service.request(baseInput);

      expect(sent[0]?.workflowVersionId).toBe("version_2");
    });

    /** @scenario A specific committed version can be requested */
    it("evaluates the requested version", async () => {
      const { service } = buildService();

      const started = await service.request({ ...baseInput, versionId: "version_1" });

      expect(started.workflowVersionId).toBe("version_1");
      expect(started.version).toBe("1");
    });

    /** @scenario Caller-supplied parameters are accepted */
    it("binds an undeclared parameter as a target input and dataset mapping", async () => {
      const { service, experimentsAsked } = buildService();

      await service.request({ ...baseInput, parameters: { feature_flag: "variant-b" } });

      const target = persistedTargetsSchema.parse(experimentsAsked[0]?.workbenchState).targets[0];
      const inputIdentifiers = target?.inputs.map((i) => i.identifier);
      expect(inputIdentifiers).toContain("feature_flag");
      expect(inputIdentifiers).toContain("question");
      expect(Object.keys(Object.values(target?.mappings ?? {})[0] ?? {})).toContain("feature_flag");
    });

    /** @scenario Inline data can be evaluated instead of the attached dataset */
    it("accepts inline data and sends it with the request", async () => {
      const { service, sent } = buildService();

      await service.request({ ...baseInput, data: [{ question: "x" }, { question: "y" }] });

      expect(sent[0]?.data).toEqual([{ question: "x" }, { question: "y" }]);
    });

    /** @scenario The evaluation runs on the worker under the run id it answered with */
    it("sends it under the same id, which the poller reads running once folded", async () => {
      const { service, sent, folds } = buildService();

      const started = await service.request(baseInput);

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        tenantId: PROJECT_ID,
        runId: started.runId,
        experimentId: "experiment_1",
        workflowId: WORKFLOW_ID,
      });
      const read = await folds.readRunProgress({ runId: started.runId });
      expect(read.kind === "folded" ? read.state : undefined).toMatchObject({
        status: "running",
        progress: 0,
        total: 3,
      });
    });
  });

  describe("given a worker that has not folded the request yet", () => {
    /** @scenario "A requested evaluation answers as soon as its request command is written" */
    it("answers at once with the run's start recorded for the poller", async () => {
      const { service, sent, folds } = buildService({ workerIdle: true });

      const started = await service.request(baseInput);

      expect(sent).toHaveLength(1);
      expect((await folds.readRunProgress({ runId: started.runId })).kind).toBe("empty");
      expect(await folds.findRunStart({ runId: started.runId })).toEqual([
        {
          projectId: PROJECT_ID,
          runId: started.runId,
          experimentId: "experiment_1",
          total: 3,
          startedAt: expect.any(Number),
        },
      ]);
    });
  });

  describe("given a workflow id from another project", () => {
    /** @scenario Unknown workflow returns not found */
    it("refuses with workflow_not_found and sends nothing", async () => {
      const { service, sent } = buildService({ workflows: {} });

      await expect(service.request(baseInput)).rejects.toMatchObject({
        code: "workflow_not_found",
      });
      expect(sent).toHaveLength(0);
    });
  });

  describe("given a workflow that was never committed", () => {
    /** @scenario A workflow with no committed version cannot be evaluated */
    it("refuses with workflow_version_required", async () => {
      const { service } = buildService({
        workflows: {
          [WORKFLOW_ID]: { id: WORKFLOW_ID, name: "Never committed", versions: [] },
        },
      });

      await expect(service.request(baseInput)).rejects.toMatchObject({
        code: "workflow_version_required",
      });
    });
  });

  describe("given more rows than the plan allows per run", () => {
    /** @scenario Rows beyond the plan's bound are refused before a run starts */
    it("refuses with experiment_evaluation_too_many_rows", async () => {
      const { service, sent } = buildService({ rowBound: 1 });

      await expect(
        service.request({ ...baseInput, data: [{ question: "x" }, { question: "y" }] }),
      ).rejects.toMatchObject({ code: "experiment_evaluation_too_many_rows", httpStatus: 422 });
      expect(sent).toHaveLength(0);
    });
  });
});

describe("WorkflowEvaluationService.run", () => {
  describe("given a request whose run already moved on", () => {
    /** @scenario A redelivered evaluation request does not run twice */
    it("skips it without starting or failing the run", async () => {
      const { service, folds, starts, completions } = buildService();
      const started = await service.request(baseInput);
      const read = await folds.readRunProgress({ runId: started.runId });
      if (read.kind === "folded") {
        await folds.writeProgress({ state: { ...read.state, status: "completed", seq: 2 } });
      }

      await service.run(requestFor(started.runId));

      expect(starts()).toEqual([]);
      expect(completions()).toEqual([]);
    });
  });

  describe("given a request whose start the fold has not caught up with", () => {
    /** @scenario A redelivered evaluation request does not run twice */
    it("starts it, leaving a second start to the start's idempotency key", async () => {
      const { service, starts } = buildService();

      await service.run(requestFor("run_unfolded"));

      expect(starts()).toMatchObject([{ runId: "run_unfolded" }]);
    });
  });

  describe("given a registered request for a workflow with a committed version", () => {
    /** @scenario The worker starts a requested evaluation on the run's pipeline with its plan */
    it("starts the run under its id with a plan of one cell per row", async () => {
      const { service, starts } = buildService();
      const started = await service.request(baseInput);

      await service.run(requestFor(started.runId));

      const [start] = starts();
      expect(start).toMatchObject({
        tenantId: PROJECT_ID,
        runId: started.runId,
        experimentId: "experiment_1",
        workflowVersionId: "version_2",
        total: 3,
      });
      expect(start?.plan).toMatchObject({
        origin: "workflow",
        persistResults: false,
        concurrency: 1,
        experimentSlug: "evaluate-me",
        runUrl: `https://app.langwatch.test/${PROJECT_SLUG}/experiments/evaluate-me?runId=${started.runId}`,
      });
      expect(start?.plan?.cells.map((cell) => cell.rowIndex)).toEqual([0, 1, 2]);
    });
  });

  describe("given a request the worker cannot prepare", () => {
    /** @scenario A requested evaluation the worker cannot prepare completes failed with its code */
    it("completes the run failed with the refusal, and starts nothing", async () => {
      const { service, fold, starts, completions } = buildService({
        workflows: { [WORKFLOW_ID]: { id: WORKFLOW_ID, name: "Evaluate me", versions: [] } },
      });
      await fold(requestFor("run_1"));

      await service.run(requestFor("run_1"));

      expect(starts()).toEqual([]);
      expect(completions()).toMatchObject([
        {
          tenantId: PROJECT_ID,
          runId: "run_1",
          experimentId: "experiment_1",
          outcome: "failed",
          total: 3,
        },
      ]);
      expect(completions()[0]?.error?.code).toBe("workflow_version_required");
    });
  });
});

function requestFor(runId: string): WorkflowEvaluationRequestedEventData & { tenantId: string } {
  return {
    tenantId: PROJECT_ID,
    runId,
    experimentId: "experiment_1",
    experimentSlug: "evaluate-me",
    projectSlug: PROJECT_SLUG,
    workflowId: WORKFLOW_ID,
    workflowVersionId: "version_2",
    total: 3,
  };
}
