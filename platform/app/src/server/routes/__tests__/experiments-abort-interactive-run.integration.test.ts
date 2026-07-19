/**
 * @vitest-environment node
 *
 * @see specs/experiments-v3/execution-backend.feature
 *
 * Regression guard: an interactive workbench run streams over SSE and never
 * creates a polling run-state record (runStateManager.createRun is only called
 * by the CI/CD polling path). The orchestrator instead registers the run owner
 * via abortManager.setRunning. Before the fix, POST /api/experiments/abort only
 * consulted runStateManager.getRunState, so every workbench run 404'd and the
 * Stop button reported "Abort Failed". Abort must authorize against the
 * running-owner that the orchestrator records.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({ user: { id: "user_1" } }),
}));

vi.mock("~/server/api/rbac", async (importActual) => {
  const actual = await importActual<typeof import("~/server/api/rbac")>();
  return { ...actual, hasProjectPermission: vi.fn().mockResolvedValue(true) };
});

// Interactive runs have no polling run-state record.
const getRunState = vi.fn().mockResolvedValue(null);
vi.mock("~/server/experiments-v3/execution/runStateManager", () => ({
  runStateManager: {
    getRunState: (...args: unknown[]) => getRunState(...args),
  },
}));

const requestAbort = vi.fn().mockResolvedValue(undefined);
vi.mock("~/server/experiments-v3/execution/orchestrator", () => ({
  requestAbort: (...args: unknown[]) => requestAbort(...args),
  runOrchestrator: vi.fn(),
}));

const getRunningProjectId = vi.fn();
const managerAbort = vi.fn().mockResolvedValue(undefined);
vi.mock("~/server/experiments-v3/execution/abortManager", () => ({
  abortManager: {
    requestAbort: (...args: unknown[]) => managerAbort(...args),
    getRunningProjectId: (...args: unknown[]) => getRunningProjectId(...args),
  },
}));

const post = async (body: unknown) => {
  const { app } = await import("../experiments-v3");
  return app.request("/api/experiments/abort", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};

describe("POST /api/experiments/abort for an interactive run", () => {
  beforeEach(() => {
    getRunState.mockReset().mockResolvedValue(null);
    getRunningProjectId.mockReset();
    requestAbort.mockClear();
    managerAbort.mockClear();
  });

  describe("when the run is registered only by the orchestrator running-owner", () => {
    /** @scenario "Project members can stop their own running workbench execution" */
    it("returns 200 and signals the abort even with no polling run-state", async () => {
      // The orchestrator recorded the owner via setRunning; runStateManager has nothing.
      getRunningProjectId.mockResolvedValue("project_MINE");

      const res = await post({ projectId: "project_MINE", runId: "run-123" });

      expect(res.status).toBe(200);
      expect(requestAbort).toHaveBeenCalledWith("run-123");
      expect(managerAbort).toHaveBeenCalledWith("run-123");
      // The polling run-state is never consulted once the running-owner matches.
      expect(getRunState).not.toHaveBeenCalled();
    });
  });

  describe("when a different project owns the in-flight run", () => {
    it("returns 404 and does not signal an abort", async () => {
      getRunningProjectId.mockResolvedValue("project_OTHER");

      const res = await post({ projectId: "project_MINE", runId: "run-123" });

      expect(res.status).toBe(404);
      expect(requestAbort).not.toHaveBeenCalled();
      expect(managerAbort).not.toHaveBeenCalled();
    });
  });
});
