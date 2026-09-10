/**
 * `POST /api/experiment/init`, driven through the real Hono app the API process mounts.
 */
import { createRestRuntime } from "@langwatch/api/rest";
import {
  EvaluationApp,
  type EvaluationInfrastructure,
  evaluationsLegacyRest,
} from "@langwatch/evaluation-server";
import type { Experiment } from "@langwatch/experiment-contract";
import type { ExperimentService } from "@langwatch/experiment-server";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  composeApiExperimentFindOrCreate,
  mountExperimentInitRest,
} from "../experiment-init-rest.mount.ts";
import type { HandlerManagedCredential } from "../../../app/api-handler-managed-credential.ts";
import {
  experimentApiRestRuntime,
  experimentApp,
  renderExperimentRestError,
  successfulCredential,
} from "./experiment-rest.fixture.ts";

const initInit = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("given the SDK's experiment create-or-take door", () => {
  describe("when a key that may manage experiments names a free slug", () => {
    it("creates the experiment and answers the app path built from the project's slug", async () => {
      const save = vi.fn(async (input: { requestedSlug: string }) =>
        experimentRow({ id: "experiment_1", slug: input.requestedSlug }),
      );
      const api = mount({ experiments: { findBySlug: async () => null, save } });

      const response = await api.fetch(
        "/api/experiment/init",
        initInit({ experiment_slug: "nightly_sweep", experiment_type: "BATCH_EVALUATION_V2" }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        slug: "nightly-sweep",
        path: "/acme/experiments/nightly-sweep",
      });
    });
  });

  describe("when the same slug is then reported against", () => {
    it("resolves ONE experiment across the init door and the batch result log", async () => {
      const stored = new Map<string, Experiment>();
      const save = vi.fn(async (input: { id: string; requestedSlug: string }) => {
        const row = experimentRow({ id: input.id, slug: input.requestedSlug });
        stored.set(row.slug, row);
        return row;
      });
      const startExperimentRun = vi.fn(async () => {});
      const api = mount({
        experiments: {
          findBySlug: async ({ slug }: { slug: string }) => stored.get(slug) ?? null,
          save,
          startExperimentRun,
        },
      });

      const created = await api.fetch(
        "/api/experiment/init",
        initInit({ experiment_slug: "nightly_sweep", experiment_type: "BATCH_EVALUATION_V2" }),
      );
      expect(created.status).toBe(200);

      const logged = await api.fetch(
        "/api/evaluations/batch/log_results",
        initInit({
          experiment_slug: "nightly_sweep",
          run_id: "run-1",
          timestamps: { created_at: 1_700_000_000_000 },
          dataset: [],
          evaluations: [],
        }),
      );

      expect(logged.status).toBe(200);
      expect(save).toHaveBeenCalledTimes(1);
      expect(startExperimentRun).toHaveBeenCalledWith(
        expect.objectContaining({
          experimentId: stored.get("nightly-sweep")?.id,
          runId: "run-1",
        }),
      );
    });
  });

  describe("when neither identifier is supplied", () => {
    it("refuses at 400 with the validation sentence, before anything is read", async () => {
      const save = vi.fn();
      const findBySlug = vi.fn();
      const api = mount({ experiments: { findBySlug, save } });

      const response = await api.fetch(
        "/api/experiment/init",
        initInit({ experiment_type: "DSPY" }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
      expect(findBySlug).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe("when the body is not valid JSON", () => {
    it("answers the door's own bare sentence rather than a validation report", async () => {
      const api = mount({ experiments: {} });

      const response = await api.fetch("/api/experiment/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ message: "Bad request" });
    });
  });

  describe("when the key lacks experiments:manage", () => {
    it("answers the ceiling refusal as sent, with nothing read", async () => {
      const findBySlug = vi.fn();
      const api = mount({
        experiments: { findBySlug },
        credential: {
          ok: false,
          status: 403,
          body: { error: "api_key_permission_denied", permission: "experiments:manage" },
        },
      });

      const response = await api.fetch(
        "/api/experiment/init",
        initInit({ experiment_slug: "nightly_sweep", experiment_type: "DSPY" }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "api_key_permission_denied",
      });
      expect(findBySlug).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------

function mount(options: {
  experiments: Partial<ExperimentService>;
  credential?: HandlerManagedCredential;
}) {
  const credential = options.credential ?? successfulCredential();
  const authenticate = async () => credential;
  const { app, experiments } = experimentApp({
    findBySlug: async () => null,
    startExperimentRun: async () => {},
    recordTargetResult: async () => {},
    recordEvaluatorResult: async () => {},
    completeExperimentRun: async () => {},
    ...options.experiments,
  });

  // The SAME construction handed to both doors — which is the fact under test.
  const findOrCreate = composeApiExperimentFindOrCreate(experiments);
  const runtime = experimentApiRestRuntime();
  const evaluationRuntime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "user", id: "user-1" },
        scope: { tier: "project", id: "project-1" },
      }),
    },
  });
  const infrastructure = createApiFixture<EvaluationInfrastructure>({
    experiments: {
      findOrCreate: (input) =>
        findOrCreate.resolve({
          projectId: input.projectId,
          experimentId: input.experimentId,
          experimentSlug: input.experimentSlug,
          experimentType: input.experimentType,
          experimentName: input.experimentName,
          workflowId: input.workflowId,
        }),
      findBySlug: (input) => experiments.findBySlug(input),
    },
    experimentRuns: {
      startRun: ({ tenantId, ...input }) =>
        experiments.startExperimentRun({ projectId: tenantId, ...input }),
      recordTargetResult: ({ tenantId, ...input }) =>
        experiments.recordTargetResult({ projectId: tenantId, ...input }),
      recordEvaluatorResult: ({ tenantId, ...input }) =>
        experiments.recordEvaluatorResult({ projectId: tenantId, ...input }),
      completeRun: ({ tenantId, ...input }) =>
        experiments.completeExperimentRun({ projectId: tenantId, ...input }),
    },
    report: { reportEvaluation: async () => {} },
  });
  const evaluations = EvaluationApp.create({
    infrastructure,
    dependencies: {
      workflows: createApiFixture<WorkflowApi>(),
      traces: createApiFixture<TraceApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
    },
    config: void 0,
    resources: new ResourceScope(),
    repositories: createApiFixture(),
  });

  const hono = new Hono()
    .route(
      "/",
      mountExperimentInitRest(runtime, {
        experiments: () => app,
        collaborators: { credential: authenticate, findOrCreate },
        errors: renderExperimentRestError,
      }),
    )
    .route(
      "/",
      evaluationRuntime.mount(evaluationsLegacyRest.router(), { app: () => evaluations }),
    );

  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

function experimentRow(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: "experiment_0",
    name: null,
    type: "BATCH_EVALUATION_V2",
    slug: "experiment-0",
    projectId: "project-1",
    workflowId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
    workbenchState: null,
    workbenchVersion: 0,
    ...overrides,
  };
}
