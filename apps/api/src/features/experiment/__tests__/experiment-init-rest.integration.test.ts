/**
 * `POST /api/experiment/init`, driven through the real Hono app the API
 * process mounts.
 *
 * The thing worth pinning is the one that made this route worth moving: the
 * experiment it resolves and the one `POST /api/evaluations/batch/log_results`
 * resolves are the SAME experiment, because both doors are handed the same
 * `ExperimentFindOrCreateService` instance. So the two are mounted together
 * here and driven with one slug.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type { Experiment, ExperimentService } from "@langwatch/experiment-contract";
import { ExperimentFindOrCreateService } from "@langwatch/experiment-server";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { mountExperimentInitRest } from "../experiment-init-rest.mount";
import { mountEvaluationsLegacyRest } from "../../evaluation/evaluations-legacy-rest.mount";
import type { HandlerManagedCredential } from "../../../app/api-handler-managed-credential";

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
      const api = mount({ experiments: { tryGetBySlug: async () => null, save } });

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
          tryGetBySlug: async ({ slug }: { slug: string }) => stored.get(slug) ?? null,
          save,
          startExperimentRun,
        },
      });

      const created = await api.fetch(
        "/api/experiment/init",
        initInit({ experiment_slug: "nightly_sweep", experiment_type: "BATCH_EVALUATION_V2" }),
      );
      const { slug } = (await created.json()) as { slug: string };

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
      // ONE creation, and the run history is addressed by the experiment the
      // init door already minted rather than by a second one.
      expect(save).toHaveBeenCalledTimes(1);
      expect(startExperimentRun).toHaveBeenCalledWith(
        expect.objectContaining({ experimentId: stored.get(slug)?.id, runId: "run-1" }),
      );
    });
  });

  describe("when neither identifier is supplied", () => {
    it("refuses at 400 with the validation sentence, before anything is read", async () => {
      const save = vi.fn();
      const tryGetBySlug = vi.fn();
      const api = mount({ experiments: { tryGetBySlug, save } });

      const response = await api.fetch(
        "/api/experiment/init",
        initInit({ experiment_type: "DSPY" }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
      expect(tryGetBySlug).not.toHaveBeenCalled();
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
      const tryGetBySlug = vi.fn();
      const api = mount({
        experiments: { tryGetBySlug },
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
      expect(tryGetBySlug).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------

function mount(options: {
  experiments: Partial<Record<string, unknown>>;
  credential?: HandlerManagedCredential;
}) {
  const credential: HandlerManagedCredential = options.credential ?? {
    ok: true,
    project: { id: "project-1", slug: "acme", teamId: "team-1" } as never,
    resolved: { type: "project" } as never,
    markUsed: () => {},
  };
  const authenticate = async () => credential;

  const experiments = {
    getById: async () => {
      throw new Error("getById is not part of this scenario");
    },
    tryGetBySlug: async () => null,
    save: async () => {
      throw new Error("save is not part of this scenario");
    },
    startExperimentRun: async () => {},
    recordTargetResult: async () => {},
    recordEvaluatorResult: async () => {},
    completeExperimentRun: async () => {},
    ...options.experiments,
  } as unknown as ExperimentService;

  // The SAME construction handed to both doors — which is the fact under test.
  const findOrCreate = ExperimentFindOrCreateService.create(experiments);
  const security = passThroughSecurity();

  const hono = new Hono()
    .route(
      "/",
      mountExperimentInitRest({
        security,
        collaborators: { credential: authenticate, findOrCreate },
      }),
    )
    .route(
      "/",
      mountEvaluationsLegacyRest({
        security,
        credential: authenticate,
        batch: {
          findOrCreate,
          experiments: () => experiments,
          reportEvaluation: async () => {},
        },
      }),
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

function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
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

const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { httpStatus?: number; code?: string; message?: string };
  if (typeof handled.httpStatus === "number") {
    return c.json({ error: handled.code ?? "error" }, handled.httpStatus as never);
  }
  return c.json({ error: String(error) }, 500);
};
