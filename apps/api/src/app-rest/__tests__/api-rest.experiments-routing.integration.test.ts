/**
 * @see specs/experiments-v3/experiments-list.feature
 * @see specs/experiments-v3/execution-backend.feature
 */

/*
 * `/api/experiments` is shared by three families: the session-driven execute door, the
 * API-key runs reads, and the list-and-read family whose `:slug` sits at the same root.
 */
import type { ExperimentApp } from "@langwatch/experiment-server";
import { ExperimentNotFoundError } from "@langwatch/experiment-contract";
import { describe, expect, it, vi } from "vitest";

import type { ApiExperimentV3RestCollaborators } from "../../features/experiment/experiment-v3-rest.mount";
import { REST_AUTH_PROJECT, RestAuthWorld, type RestAuthKey } from "./support/rest-auth.world";
import { mountRestFamily, type MountedRestFamily } from "./support/rest-family.harness";

const PROJECT_KEY = "sk-lw-alpha-experiments";
const KEYS: readonly RestAuthKey[] = [
  { token: PROJECT_KEY, projectId: REST_AUTH_PROJECT.id, apiKeyId: "key-experiments" },
];

const EXECUTE_BODY = {
  projectId: REST_AUTH_PROJECT.id,
  name: "regression-test",
  dataset: { id: "dataset-1", name: "ds", type: "inline" as const, columns: [] },
  targets: [],
  evaluators: [],
  scope: { type: "full" as const },
};

function mount(
  options: {
    session?: { user: { id: string } } | null;
    runs?: Awaited<ReturnType<ExperimentApp["getRunsPageBySlug"]>> | Error;
  } = {},
): MountedRestFamily & { getRunsPageBySlug: ReturnType<typeof vi.fn> } {
  const world = RestAuthWorld.create({ keys: KEYS });
  const runs = options.runs;
  const getRunsPageBySlug = vi.fn(async () => {
    if (runs instanceof Error) throw runs;
    return (
      runs ?? {
        experiment: { id: "experiment-1", slug: "checkout" },
        runs: [],
        totalHits: 0,
      }
    );
  });

  const experiments = {
    getRunsPageBySlug,
    getPage: vi.fn(async () => ({ experiments: [], totalHits: 0 })),
    withRunAggregates: vi.fn(async () => []),
    tryGetBySlug: vi.fn(async () => null),
  } as unknown as ExperimentApp;

  const workbench: ApiExperimentV3RestCollaborators = {
    session: {
      resolve: async () => options.session ?? null,
      permitted: async () => true,
    } as never,
    credential: (async ({ request }: { request: Request }) => {
      const authorization = request.headers.get("authorization");
      if (authorization !== `Bearer ${PROJECT_KEY}`) {
        return {
          ok: false,
          status: 401,
          body: { error: "Unauthorized", message: "Authentication required." },
        };
      }
      return {
        ok: true,
        project: REST_AUTH_PROJECT,
        resolved: null,
        markUsed: () => {},
      };
    }) as never,
    experiments: () => experiments,
    run: { ports: undefined, progress: undefined, services: {} } as never,
  };

  const api = mountRestFamily({
    security: world.security(),
    services: { experimentWorkbench: workbench },
    packaged: { experiments: () => experiments } as never,
  });

  return Object.assign(api, { getRunsPageBySlug });
}

describe("given the runs listing on the experiment workbench", () => {
  describe("when the request carries no credential", () => {
    /** @scenario "Unauthenticated runs request returns 401" */
    it("refuses it before any experiment is read", async () => {
      const api = mount();

      const response = await api.get("/api/experiments/runs?experimentSlug=checkout");

      expect(response.status).toBe(401);
      expect(api.getRunsPageBySlug).not.toHaveBeenCalled();
    });
  });

  describe("when the request names no experiment", () => {
    /** @scenario "Missing experimentSlug returns 400" */
    it("says which query parameter is required", async () => {
      const api = mount();

      const response = await api.get("/api/experiments/runs", {
        authorization: `Bearer ${PROJECT_KEY}`,
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining("experimentSlug"),
      });
    });
  });

  describe("when the experiment does not exist in this project", () => {
    /** @scenario "Unknown experiment slug returns 404" */
    it("answers not found", async () => {
      const api = mount({ runs: new ExperimentNotFoundError("nope") });

      const response = await api.get("/api/experiments/runs?experimentSlug=nope", {
        authorization: `Bearer ${PROJECT_KEY}`,
      });

      expect(response.status).toBe(404);
    });
  });

  describe("when the caller is authenticated and the experiment has runs", () => {
    /** @scenario "Authenticated request returns runs for the experiment" */
    it("answers the experiment's runs, newest first, with its pagination", async () => {
      const api = mount({
        runs: {
          experiment: { id: "experiment-1", slug: "checkout" },
          runs: [{ runId: "run-2" }, { runId: "run-1" }],
          totalHits: 2,
        } as never,
      });

      const response = await api.get("/api/experiments/runs?experimentSlug=checkout", {
        authorization: `Bearer ${PROJECT_KEY}`,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        experimentSlug: "checkout",
        runs: [{ runId: "run-2" }, { runId: "run-1" }],
        pagination: { page: 1, totalHits: 2, hasMore: false },
      });
    });
  });

  describe("when the experiment has never been run", () => {
    /** @scenario "Experiment without runs returns an empty list" */
    it("answers an empty list rather than a not-found", async () => {
      const api = mount();

      const response = await api.get("/api/experiments/runs?experimentSlug=checkout", {
        authorization: `Bearer ${PROJECT_KEY}`,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        runs: [],
        pagination: { totalHits: 0, hasMore: false },
      });
    });
  });
});

describe("given the three families sharing the /api/experiments namespace", () => {
  describe("when a read-one request carries no project key", () => {
    /**
     * A 404 here would mean no route matched at all, which is the bug the route exists to
     * fix: the caller could not tell a missing route from a missing experiment.
     */
    /** @scenario "Reading one experiment needs the project key" */
    it("is answered by the credential guard, not by a framework 404", async () => {
      const api = mount();

      const response = await api.get("/api/experiments/some-slug");

      expect(response.status).toBe(401);
    });
  });

  describe("when the path is the runs collection rather than a slug", () => {
    /** @scenario "The runs routes keep their own handlers" */
    it("does not let the slug parameter swallow the literal /runs", async () => {
      const api = mount();

      // With the slug route answering, an unauthenticated read is refused with
      // no chance to say what it wanted; the runs route's own guard names the
      // missing query parameter once a credential is presented, which is the
      // proof that the literal sibling still owns the path.
      const response = await api.get("/api/experiments/runs", {
        authorization: `Bearer ${PROJECT_KEY}`,
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining("experimentSlug"),
      });
    });
  });
});

describe("given the workbench execute door, which a browser reaches", () => {
  describe("when the request carries a session and no project key", () => {
    /** @scenario "Browser execution authenticates by user session" */
    it("is never answered by the project API-key guard", async () => {
      const api = mount({ session: { user: { id: "user-alpha" } } });

      const response = await api.post("/api/experiments/execute", EXECUTE_BODY);

      // The run loop is absent in this composition, so the door answers 503 —
      // which is already past every credential check, and that is the point.
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });
  });

  describe("when the request carries neither a session nor a key", () => {
    /** @scenario "Execution endpoint rejects requests with no session" */
    it("answers the session guard's own refusal, telling the person to log in", async () => {
      const api = mount({ session: null });

      const response = await api.post("/api/experiments/execute", EXECUTE_BODY);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "You must be logged in to access this endpoint.",
      });
    });
  });
});
