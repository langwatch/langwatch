/**
 * The two doors a CI/CD pipeline drives: start a saved evaluation, then poll it.
 * A pipeline holds a project key and a slug and nothing else.
 * @see specs/experiments-v3/ci-cd-execution.feature
 */
import type { AuthzService } from "@langwatch/authz-contract";
import type { ExperimentApp } from "@langwatch/experiment-server";
import { describe, expect, it, vi } from "vitest";

import { ApiHandlerManagedCredentials } from "../../app/api-handler-managed-credential.ts";
import type { ApiExperimentV3RestCollaborators } from "../../features/experiment/experiment-v3-rest.mount.ts";
import { REST_AUTH_PROJECT, RestAuthWorld } from "./support/rest-auth.world.ts";
import { mountRestFamily, type MountedRestFamily } from "./support/rest-family.harness.ts";

const PROJECT_KEY = "sk-lw-alpha-cicd";
const SLUG = "my-evaluation";

/** The saved setup a pipeline runs: two rows, one target, no evaluators. */
const savedWorkbenchState = {
  experimentSlug: SLUG,
  name: "CI/CD evaluation",
  datasets: [
    {
      id: "dataset-1",
      name: "Questions",
      type: "inline",
      inline: {
        columns: [{ id: "question", name: "question", type: "string" }],
        records: { question: ["Say hello", "Say world"] },
      },
      columns: [{ id: "question", name: "question", type: "string" }],
    },
  ],
  activeDatasetId: "dataset-1",
  targets: [
    {
      id: "target-1",
      type: "prompt",
      name: "Inline prompt",
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      mappings: {
        "dataset-1": {
          input: {
            type: "source",
            source: "dataset",
            sourceId: "dataset-1",
            sourceField: "question",
          },
        },
      },
      localPromptConfig: {
        llm: { model: "openai/gpt-5-mini" },
        messages: [{ role: "user", content: "{{input}}" }],
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      },
    },
  ],
  evaluators: [],
};

type RunState = {
  runId: string;
  projectId: string;
  experimentId?: string;
  experimentSlug?: string;
  status: string;
  progress: number;
  total: number;
  startedAt: number;
  finishedAt?: number;
  summary?: Record<string, unknown>;
};

function mount(
  options: {
    /** `null` is the distinct case of a slug this project does not have. */
    experiment?: { id: string; slug: string; workbenchState: unknown } | null;
    runState?: RunState | null;
  } = {},
): MountedRestFamily & { startRun: ReturnType<typeof vi.fn> } {
  const world = RestAuthWorld.create({
    keys: [{ token: PROJECT_KEY, projectId: REST_AUTH_PROJECT.id, apiKeyId: "key-cicd" }],
  });
  const experiment =
    options.experiment === undefined
      ? { id: "experiment-1", slug: SLUG, workbenchState: savedWorkbenchState }
      : options.experiment;
  const findBySlugAndType = vi.fn(async () => experiment);
  const experimentService = {
    findBySlugAndType,
    isActive: async () => true,
  };
  const experiments = {
    findBySlugAndType,
    isActive: async () => true,
    experimentService,
  } as unknown as ExperimentApp;

  const startRun = vi.fn(async () => ({
    runId: "run-1",
    runUrl: `https://app.langwatch.test/alpha/experiments/${SLUG}?runId=run-1`,
    total: 2,
  }));

  const credentials = ApiHandlerManagedCredentials.create({
    apiKeys: world.apiKeys(),
    authz: {
      hasApiKeyPermission: () => Promise.resolve(true),
      getApiKeyProjectDecision: () => Promise.resolve({ outcome: "allowed" }),
    } as unknown as AuthzService,
  });

  const workbench: ApiExperimentV3RestCollaborators = {
    session: {
      resolve: () => Promise.resolve(null),
      permitted: () => Promise.resolve(false),
    } as never,
    credential: (input) => credentials.authenticate(input),
    experiments: () => experiments,
    run: {
      ports: {} as never,
      progress: {
        findRunState: async () => options.runState ?? null,
      } as never,
      // Every target carries its own prompt and the dataset is inline, so the
      // load reaches none of these: a call is an arrangement bug, not a stub.
      services: {} as never,
      workflows: {} as never,
      defaultConcurrency: 1,
      startRun,
    } as never,
  };

  const api = mountRestFamily({
    security: world.security(),
    services: { experimentWorkbench: workbench },
  });

  return Object.assign(api, { startRun });
}

describe("given a pipeline holding a project key", () => {
  describe("when it starts the run with the X-Auth-Token header", () => {
    /** @scenario "API key authentication via X-Auth-Token header" */
    it("answers the started run rather than a refusal", async () => {
      const api = mount();

      const response = await api.post(`/api/experiments/${SLUG}/run`, undefined, {
        "x-auth-token": PROJECT_KEY,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ runId: "run-1" });
    });
  });

  describe("when it starts the run with the Authorization header", () => {
    /** @scenario "API key authentication via Authorization Bearer header" */
    it("accepts the bearer form of the same key", async () => {
      const api = mount();

      const response = await api.post(`/api/experiments/${SLUG}/run`, undefined, {
        authorization: `Bearer ${PROJECT_KEY}`,
      });

      expect(response.status).toBe(200);
      expect(api.startRun).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the slug names no evaluation in this project", () => {
    /** @scenario "Evaluation not found returns 404" */
    it("answers not found, and starts nothing", async () => {
      const api = mount({ experiment: null });

      const response = await api.post("/api/experiments/no-such-evaluation/run", undefined, {
        "x-auth-token": PROJECT_KEY,
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "experiment_not_found" });
      expect(api.startRun).not.toHaveBeenCalled();
    });
  });

  describe("when it starts the run without asking for the stream", () => {
    /** @scenario "Default response returns runId for polling" */
    it("answers the run id, its size and where a person can watch it", async () => {
      const api = mount();

      const response = await api.post(`/api/experiments/${SLUG}/run`, undefined, {
        "x-auth-token": PROJECT_KEY,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        runId: "run-1",
        status: "running",
        total: 2,
        runUrl: expect.stringContaining(SLUG),
      });
    });
  });
});

describe("given a run the pipeline is polling", () => {
  describe("when the run has finished", () => {
    /** @scenario "Poll for run status when completed" */
    it("answers completed, with the summary the run ended on", async () => {
      const api = mount({
        runState: {
          runId: "run-1",
          projectId: REST_AUTH_PROJECT.id,
          experimentId: "experiment-1",
          experimentSlug: SLUG,
          status: "completed",
          progress: 2,
          total: 2,
          startedAt: 1_700_000_000_000,
          finishedAt: 1_700_000_060_000,
          summary: { total: 2, completed: 2 },
        },
      });

      const response = await api.get("/api/experiments/runs/run-1", {
        "x-auth-token": PROJECT_KEY,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        runId: "run-1",
        status: "completed",
        progress: 2,
        total: 2,
        summary: { total: 2, completed: 2 },
      });
    });
  });

  describe("when the run id belongs to no run", () => {
    /** @scenario "Poll for non-existent run returns 404" */
    it("answers not found", async () => {
      const api = mount({ runState: null });

      const response = await api.get("/api/experiments/runs/no-such-run", {
        "x-auth-token": PROJECT_KEY,
      });

      expect(response.status).toBe(404);
    });
  });
});
