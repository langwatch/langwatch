/**
 * @vitest-environment node
 * A run's pipeline side as a process composes it: what the process refuses without Redis or a
 * public address, and the folds and stop signal every replica shares through Redis.
 */
import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import type { ExperimentRunProgressState } from "../../repositories/experiment-run-fold.repository.ts";
import type { ExperimentService } from "../../services/experiment.service.ts";
import { buildExperimentRunCells } from "../experiment-composition.build.ts";

/** The three Redis commands the run's folds and stop signal use, over one map. */
function redisKeys(): ProcessMembers["redis"] {
  const keys = new Map<string, string>();
  return createApiFixture<ProcessMembers["redis"]>(
    {
      get: async (key: unknown) => keys.get(String(key)) ?? null,
      set: async (...args: unknown[]) => {
        keys.set(String(args[0]), String(args[1]));
        return "OK";
      },
      del: async (...args: unknown[]) => (keys.delete(String(args[0])) ? 1 : 0),
    },
    "redis",
  );
}

function build({
  redis,
  publicBaseUrl,
}: {
  redis: ProcessMembers["redis"] | undefined;
  publicBaseUrl: string | undefined;
}) {
  return buildExperimentRunCells({
    redis,
    publicBaseUrl,
    processName: "langwatch-test",
    runConcurrency: 4,
    logger: { warn: () => undefined },
    experiments: createApiFixture<ExperimentService>({}, "experiments"),
    attachmentEgress: { blockLocal: true, allowedHosts: [], verifyTls: true },
    dependencies: {
      workflows: createApiFixture<WorkflowApi>({}, "workflows"),
      dataset: createApiFixture<DatasetApi>({}, "dataset"),
      agents: createApiFixture<AgentApi>({}, "agents"),
      evaluators: createApiFixture<EvaluatorApi>({}, "evaluators"),
      prompts: createApiFixture<PromptApi>({}, "prompts"),
      projects: createApiFixture<ProjectApi>({}, "projects"),
      entitlement: createApiFixture<EntitlementApi>({}, "entitlement"),
      modelProviders: createApiFixture<ModelProviderApi>({}, "modelProviders"),
      evaluation: createApiFixture<EvaluationApi>({}, "evaluation"),
      apiKeys: createApiFixture<ApiKeyApi>({}, "apiKeys"),
      suite: createApiFixture<SuiteApi>({}, "suite"),
      storedObjects: createApiFixture<StoredObjectApi>({}, "storedObjects"),
    },
  });
}

const running: ExperimentRunProgressState = {
  projectId: "project_1",
  runId: "run_1",
  experimentId: "experiment_1",
  experimentSlug: "checkout-eval",
  status: "running",
  progress: 0,
  total: 2,
  startedAt: 1,
  recentEvents: [],
  seq: 1,
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
};

describe("buildExperimentRunCells", () => {
  describe("given a process with no Redis", () => {
    /** @scenario "A process without Redis refuses to start a run by name" */
    it("refuses to start a run, naming the progress store and the process", () => {
      const { refusals } = build({ redis: undefined, publicBaseUrl: "https://app.test" });

      expect(refusals.start).toEqual({
        process: "langwatch-test",
        capability: expect.stringMatching(/^progress store/),
      });
    });

    /** @scenario "A read with no progress store refuses by name" */
    it("refuses to read a run by name", () => {
      const { refusals } = build({ redis: undefined, publicBaseUrl: "https://app.test" });

      expect(refusals.read).toEqual({ capability: "experiment run progress store" });
    });
  });

  describe("given a process with Redis but no public address", () => {
    /** @scenario "A process without a public address refuses to start a run but still answers polls" */
    it("refuses to start a run and reads one", () => {
      const { refusals } = build({ redis: redisKeys(), publicBaseUrl: undefined });

      expect(refusals.start).toEqual({
        process: "langwatch-test",
        capability: expect.stringMatching(/^public address/),
      });
      expect(refusals.read).toBeUndefined();
    });
  });

  describe("given a process with Redis and a public address", () => {
    /** @scenario "Polling a run does not need the run loop that starts one" */
    it("refuses nothing, and starts a run with the configured concurrency", () => {
      const cells = build({ redis: redisKeys(), publicBaseUrl: "https://app.test" });

      expect(cells.refusals).toEqual({});
      expect(cells.concurrency).toBe(4);
    });

    /** @scenario "A run's stop signal is shared through the deployment's Redis" */
    it("records a stop request where every replica reads it", async () => {
      const redis = redisKeys();
      const api = build({ redis, publicBaseUrl: "https://app.test" });
      const worker = build({ redis, publicBaseUrl: "https://app.test" });

      await api.abort.requestAbort("run_1");

      await expect(worker.abort.isAborted("run_1")).resolves.toBe(true);
      await expect(worker.abort.isAborted("run_2")).resolves.toBe(false);
    });

    /** @scenario "Run progress is derived from the deployment's own Redis" */
    it("reads a run's progress another replica folded", async () => {
      const redis = redisKeys();
      const worker = build({ redis, publicBaseUrl: "https://app.test" });
      const api = build({ redis, publicBaseUrl: "https://app.test" });

      await worker.folds.writeProgress({ state: running });

      await expect(api.folds.readRunProgress({ runId: "run_1" })).resolves.toEqual({
        kind: "folded",
        state: running,
      });
    });
  });
});
