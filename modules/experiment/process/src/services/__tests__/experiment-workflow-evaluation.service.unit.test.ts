import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type {
  EvaluationV3Event,
  FindOrCreateWorkflowExperimentInput,
} from "@langwatch/experiment-contract";
import { resolveRequestBound, type RequestBoundKey } from "@langwatch/plans";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { WorkflowEvaluationRequestedEventData } from "../../eventing/experiment-run-events.process.ts";
import {
  ExperimentRunProgressRepository,
  type ExperimentRunProgressFailure,
  type ExperimentRunProgressState,
} from "../../repositories/experiment-run-progress.repository.ts";
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
type SentRequest = WorkflowEvaluationRequestedEventData & { tenantId: string; occurredAt: number };

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

/** The run records a poll reads, kept in memory. */
class RecordedRunProgress extends ExperimentRunProgressRepository {
  readonly runs = new Map<string, ExperimentRunProgressState>();
  readonly failures = new Map<string, ExperimentRunProgressFailure>();

  async createRun(input: {
    runId: string;
    projectId: string;
    experimentId?: string;
    experimentSlug: string;
    total: number;
  }): Promise<void> {
    this.runs.set(input.runId, {
      ...input,
      status: "running",
      progress: 0,
      startedAt: 0,
      recentEvents: [],
    });
  }
  async updateProgress(): Promise<void> {}
  async addEvent(_runId: string, _event: EvaluationV3Event): Promise<void> {}
  async completeRun(): Promise<void> {}
  async failRun(runId: string, failure: ExperimentRunProgressFailure): Promise<void> {
    this.failures.set(runId, failure);
  }
  async stopRun(): Promise<void> {}
  async findRunState(runId: string): Promise<ExperimentRunProgressState | null> {
    return this.runs.get(runId) ?? null;
  }
  async deleteRun(): Promise<void> {}
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
  overrides: { workflows?: Record<string, FakeWorkflow>; rowBound?: number } = {},
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
  const progress = new RecordedRunProgress();
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
    runLoop: {
      ports: null,
      progress,
      services,
      workflows: createApiFixture<WorkflowApi>({}),
      defaultConcurrency: 1,
      startRun: () => Promise.reject(new Error("Not used by workflow evaluation tests.")),
    },
    requests: {
      requestWorkflowEvaluation: async (input) => {
        sent.push(input);
      },
    },
    baseUrl: "https://app.langwatch.test",
  });

  return { service, experimentsAsked, sent, progress };
}

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
    it("registers the run for polling and sends it under the same id", async () => {
      const { service, sent, progress } = buildService();

      const started = await service.request(baseInput);

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        tenantId: PROJECT_ID,
        runId: started.runId,
        experimentId: "experiment_1",
        workflowId: WORKFLOW_ID,
      });
      expect(progress.runs.get(started.runId)?.status).toBe("running");
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
    it("skips it without failing the run", async () => {
      const { service, progress } = buildService();
      const started = await service.request(baseInput);
      const registered = progress.runs.get(started.runId);
      if (registered) progress.runs.set(started.runId, { ...registered, status: "completed" });

      await service.run(requestFor(started.runId));

      expect(progress.failures.size).toBe(0);
    });
  });

  describe("given a process that composed no run loop", () => {
    /** @scenario A worker without a run loop fails the run it was sent */
    it("records the run as failed rather than retrying it", async () => {
      const { service, progress } = buildService();
      const started = await service.request(baseInput);

      await service.run(requestFor(started.runId));

      expect(progress.failures.has(started.runId)).toBe(true);
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
