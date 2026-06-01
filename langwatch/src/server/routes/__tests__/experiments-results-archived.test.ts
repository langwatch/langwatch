/**
 * @vitest-environment node
 *
 * @see specs/experiments-v3/experiment-archive.feature
 *
 * Regression guard for the fresh-run-state archive bug. When the run state
 * for an archived experiment is still warm in Redis (within the 24h TTL),
 * GET /runs/:runId/results used to skip the archivedAt: null filter because
 * it short-circuited on experimentIdFromState. That meant archive
 * visibility silently depended on run age: same archived experiment, fresh
 * runs returned ClickHouse data, older runs returned 404 through the
 * slug-based fallback. This test pins the consistent behaviour: archived
 * experiments are not reachable regardless of which path resolves the id.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({ user: { id: "user_1" } }),
}));

vi.mock("~/server/api/rbac", async (importActual) => {
  const actual = await importActual<typeof import("~/server/api/rbac")>();
  return { ...actual, hasProjectPermission: vi.fn().mockResolvedValue(true) };
});

vi.mock("~/server/license-enforcement", async (importActual) => {
  const actual =
    await importActual<typeof import("~/server/license-enforcement")>();
  return { ...actual, enforceLicenseLimit: vi.fn() };
});

const getRunState = vi.fn();
vi.mock("~/server/experiments-v3/execution/runStateManager", () => ({
  runStateManager: {
    getRunState: (...args: unknown[]) => getRunState(...args),
  },
}));

const findFirst = vi.fn();
vi.mock("~/server/db", () => ({
  prisma: {
    experiment: { findFirst: (...args: unknown[]) => findFirst(...args) },
  },
}));

const getRun = vi.fn();
vi.mock("~/server/experiments-v3/services/experiment-run.service", () => ({
  ExperimentRunService: {
    create: () => ({
      getRun: (...args: unknown[]) => getRun(...args),
    }),
  },
}));

const fakeProject = { id: "project_MINE", apiKey: "key_MINE" };
const resolve = vi.fn().mockResolvedValue({
  type: "apiKey",
  apiKeyId: "ak_test",
  project: fakeProject,
});
const markUsed = vi.fn();
vi.mock("~/server/api-key/token-resolver", () => ({
  TokenResolver: {
    create: () => ({
      resolve: (...args: unknown[]) => resolve(...args),
      markUsed: (...args: unknown[]) => markUsed(...args),
    }),
  },
}));

vi.mock("~/server/api-key/auth-middleware", async (importActual) => {
  const actual =
    await importActual<typeof import("~/server/api-key/auth-middleware")>();
  return {
    ...actual,
    enforceApiKeyCeiling: vi.fn().mockResolvedValue(undefined),
    apiKeyCeilingDenialResponse: () => ({ status: 401, message: "denied" }),
    extractCredentials: () => ({ token: "key_MINE" }),
  };
});

const get = async (path: string) => {
  const { app } = await import("../experiments-v3");
  return app.request(path, {
    method: "GET",
    headers: { "X-Auth-Token": "key_MINE" },
  });
};

describe("GET /api/experiments/runs/:runId/results archive visibility", () => {
  beforeEach(() => {
    getRunState.mockReset();
    findFirst.mockReset();
    getRun.mockReset();
  });

  describe("given a fresh Redis-cached run whose owning experiment was just archived", () => {
    /** @scenario Archived experiments are hidden from the standard list query */
    it("returns 404 even though experimentIdFromState resolved", async () => {
      getRunState.mockResolvedValue({
        runId: "run_x",
        projectId: "project_MINE",
        experimentId: "experiment_ARCHIVED",
        experimentSlug: "x-archived-abc",
        status: "completed",
      });
      findFirst.mockResolvedValue(null);

      const res = await get("/api/experiments/runs/run_x/results");

      expect(res.status).toBe(404);
      expect(findFirst).toHaveBeenCalledWith({
        where: {
          id: "experiment_ARCHIVED",
          projectId: "project_MINE",
          archivedAt: null,
        },
        select: { id: true },
      });
      expect(getRun).not.toHaveBeenCalled();
    });
  });

  describe("given a fresh Redis-cached run whose experiment is still live", () => {
    it("returns the run data", async () => {
      getRunState.mockResolvedValue({
        runId: "run_y",
        projectId: "project_MINE",
        experimentId: "experiment_LIVE",
        experimentSlug: "y-live",
        status: "completed",
      });
      findFirst.mockResolvedValue({ id: "experiment_LIVE" });
      getRun.mockResolvedValue({ rows: [{ score: 1 }] });

      const res = await get("/api/experiments/runs/run_y/results");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ rows: [{ score: 1 }] });
    });
  });
});

describe("GET /api/experiments/runs/:runId archive visibility", () => {
  beforeEach(() => {
    getRunState.mockReset();
    findFirst.mockReset();
    getRun.mockReset();
  });

  describe("given a fresh Redis-cached run whose owning experiment was just archived", () => {
    /** @scenario Archived experiments are hidden from the standard list query */
    it("returns 404 instead of leaking the cached run status", async () => {
      getRunState.mockResolvedValue({
        runId: "run_status_x",
        projectId: "project_MINE",
        experimentId: "experiment_ARCHIVED",
        experimentSlug: "x-archived-abc",
        status: "completed",
        progress: 10,
        total: 10,
        startedAt: 1,
        finishedAt: 2,
        summary: { ok: true },
      });
      findFirst.mockResolvedValue(null);

      const res = await get("/api/experiments/runs/run_status_x");

      expect(res.status).toBe(404);
      expect(findFirst).toHaveBeenCalledWith({
        where: {
          id: "experiment_ARCHIVED",
          projectId: "project_MINE",
          archivedAt: null,
        },
        select: { id: true },
      });
    });
  });

  describe("given a fresh Redis-cached run whose experiment is still live", () => {
    it("returns the cached run status", async () => {
      getRunState.mockResolvedValue({
        runId: "run_status_y",
        projectId: "project_MINE",
        experimentId: "experiment_LIVE",
        experimentSlug: "y-live",
        status: "completed",
        progress: 5,
        total: 5,
        startedAt: 1,
        finishedAt: 2,
        summary: { ok: true },
      });
      findFirst.mockResolvedValue({ id: "experiment_LIVE" });

      const res = await get("/api/experiments/runs/run_status_y");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.runId).toBe("run_status_y");
      expect(body.status).toBe("completed");
    });
  });
});
