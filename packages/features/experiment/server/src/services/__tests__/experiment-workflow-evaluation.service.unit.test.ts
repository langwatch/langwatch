import { describe, expect, it, vi } from "vitest";
import type { ExperimentWorkflowDslPort } from "../../ports/experiment-workflow-dsl.port";
import type { ExperimentRunProgressPort } from "../../ports/experiment-run-progress.port";
import {
  WorkflowEvaluationService,
  type WorkflowEvaluationDependencies,
} from "../experiment-workflow-evaluation.service";

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

/**
 * In-memory ExperimentWorkflowDslPort. `tryFindEvaluableVersion` returns the last-pushed version when no versionId is named — a stand-in for the real
 * Postgres adapter's createdAt ordering (@langwatch/api-experiment-run's PostgresExperimentWorkflowDslAdapter), which needs a live database to prove.
 * This fake only proves the SERVICE delegates the "which version" decision to the port rather than deciding it itself.
 */
function buildWorkflowSource(workflows: Record<string, FakeWorkflow>): ExperimentWorkflowDslPort {
  return {
    async tryFindWorkflow(input) {
      const wf = workflows[input.workflowId];
      if (!wf || wf.archived) return null;
      return { id: wf.id, name: wf.name, publishedId: wf.versions.at(-1)?.id ?? null };
    },
    async tryFindVersionDsl(input) {
      const wf = workflows[input.workflowId];
      return wf?.versions.find((v) => v.id === input.versionId)?.dsl ?? null;
    },
    async tryFindEvaluableWorkflow(input) {
      const wf = workflows[input.workflowId];
      if (!wf || wf.archived) return null;
      return { id: wf.id, name: wf.name };
    },
    async tryFindEvaluableVersion(input) {
      const wf = workflows[input.workflowId];
      if (!wf) return null;
      if (input.versionId) {
        return wf.versions.find((v) => v.id === input.versionId) ?? null;
      }
      return wf.versions.at(-1) ?? null;
    },
  };
}

function buildDeps(
  overrides: {
    workflows?: Record<string, FakeWorkflow>;
    findOrCreateForWorkflow?: ReturnType<typeof vi.fn>;
  } = {},
): { deps: WorkflowEvaluationDependencies; findOrCreateForWorkflow: ReturnType<typeof vi.fn> } {
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
  const findOrCreateForWorkflow =
    overrides.findOrCreateForWorkflow ??
    vi.fn().mockResolvedValue({ id: "experiment_1", slug: "evaluate-me" });

  const progress: ExperimentRunProgressPort = {
    createRun: vi.fn().mockResolvedValue(undefined),
    updateProgress: vi.fn(),
    addEvent: vi.fn(),
    completeRun: vi.fn(),
    failRun: vi.fn(),
    stopRun: vi.fn(),
    tryGetRunState: vi.fn(),
    deleteRun: vi.fn(),
  } as unknown as ExperimentRunProgressPort;

  const deps: WorkflowEvaluationDependencies = {
    experiments: { findOrCreateForWorkflow } as never,
    workflowSource,
    // The ownership check runs before any cell exists; a stub that passes is
    // what lets the run reach the part this file is about.
    ports: {
      connectedAgentOwnership: { assertRunnable: vi.fn(async () => undefined) },
    } as never,
    workflows: {} as never,
    services: {
      datasets: {} as never,
      prompts: {} as never,
      agents: {} as never,
      workflows: workflowSource,
      evaluators: {} as never,
    },
    progress,
    baseUrl: "https://app.langwatch.test",
    defaultConcurrency: 1,
  };

  return { deps, findOrCreateForWorkflow };
}

function buildService(overrides?: Parameters<typeof buildDeps>[0]) {
  const { deps, findOrCreateForWorkflow } = buildDeps(overrides);
  return { service: WorkflowEvaluationService.create(deps), findOrCreateForWorkflow };
}

const baseInput = {
  projectId: PROJECT_ID,
  projectSlug: PROJECT_SLUG,
  workflowId: WORKFLOW_ID,
};

describe("WorkflowEvaluationService.triggerEvaluationForRest", () => {
  describe("given a workflow with a committed version", () => {
    /** @scenario Triggering an evaluation returns a run id and a results url */
    it("returns a run id and a results url", async () => {
      const { service } = buildService();

      const outcome = await service.triggerEvaluationForRest(baseInput);

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      expect(typeof outcome.runId).toBe("string");
      expect(outcome.runId.length).toBeGreaterThan(0);
      expect(outcome.runUrl).toContain("/experiments/evaluate-me");
      expect(outcome.runUrl).toContain(`runId=${outcome.runId}`);
    });

    /** @scenario The response stays backward compatible */
    it("still carries the evaluated version id and version", async () => {
      const { service } = buildService();

      const outcome = await service.triggerEvaluationForRest(baseInput);

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      expect(outcome.workflowVersionId).toBe("version_2");
      expect(outcome.version).toBe("2");
    });

    /** @scenario The latest committed version is evaluated by default */
    it("evaluates the latest committed version when none is named", async () => {
      const { service } = buildService();

      const outcome = await service.triggerEvaluationForRest(baseInput);

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      // The service asks its port for "no version named" and trusts the
      // answer, rather than picking a version itself.
      expect(outcome.workflowVersionId).toBe("version_2");
    });

    /** @scenario A specific committed version can be requested */
    it("evaluates the requested version", async () => {
      const { service } = buildService();

      const outcome = await service.triggerEvaluationForRest({
        ...baseInput,
        versionId: "version_1",
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      expect(outcome.workflowVersionId).toBe("version_1");
      expect(outcome.version).toBe("1");
    });

    /** @scenario Caller-supplied parameters are accepted */
    it("binds an undeclared parameter as a target input and dataset mapping", async () => {
      const { service, findOrCreateForWorkflow } = buildService();

      const outcome = await service.triggerEvaluationForRest({
        ...baseInput,
        parameters: { feature_flag: "variant-b" },
      });

      expect(outcome.ok).toBe(true);
      const call = findOrCreateForWorkflow.mock.calls[0]?.[0] as {
        workbenchState: {
          targets: Array<{
            inputs: Array<{ identifier: string }>;
            mappings: Record<string, Record<string, unknown>>;
          }>;
        };
      };
      const target = call.workbenchState.targets[0]!;
      const inputIdentifiers = target.inputs.map((i) => i.identifier);
      expect(inputIdentifiers).toContain("feature_flag");
      expect(inputIdentifiers).toContain("question");
      const mapping = Object.values(target.mappings)[0]!;
      expect(Object.keys(mapping)).toContain("feature_flag");
    });

    /** @scenario Inline data can be evaluated instead of the attached dataset */
    it("accepts inline data and starts a run", async () => {
      const { service } = buildService();

      const outcome = await service.triggerEvaluationForRest({
        ...baseInput,
        data: [{ question: "x" }, { question: "y" }],
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("unreachable");
      expect(outcome.runUrl).toBeTruthy();
    });
  });

  describe("given a workflow id from another project", () => {
    /** @scenario Unknown workflow returns not found */
    it("returns a 404 outcome", async () => {
      const { service } = buildService({ workflows: {} });

      const outcome = await service.triggerEvaluationForRest(baseInput);

      expect(outcome).toEqual({ ok: false, status: 404, error: "Workflow not found" });
    });
  });

  describe("given a workflow that was never committed", () => {
    /** @scenario A workflow with no committed version cannot be evaluated */
    it("returns a 400 outcome explaining a version must be committed first", async () => {
      const { service } = buildService({
        workflows: {
          [WORKFLOW_ID]: { id: WORKFLOW_ID, name: "Never committed", versions: [] },
        },
      });

      const outcome = await service.triggerEvaluationForRest(baseInput);

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("unreachable");
      expect(outcome.status).toBe(400);
      expect(outcome.error).toMatch(/committed version/i);
    });
  });
});
