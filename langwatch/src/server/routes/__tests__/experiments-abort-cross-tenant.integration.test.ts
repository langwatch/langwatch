/**
 * @vitest-environment node
 *
 * @see specs/security/api-endpoint-authorization.feature
 *
 * Regression guard: POST /api/experiments/abort gated permission on the body's
 * projectId but never verified the runId belonged to that project. A user with
 * evaluations:manage on their own project could abort another tenant's run by
 * supplying that run's id. The fix loads the run state and 404s unless the run
 * is owned by the authenticated project.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({ user: { id: "user_1" } }),
}));

// The caller legitimately holds evaluations:manage on the project they name.
// Spread the real module so Resources/Actions (used by role-binding-resolver)
// stay intact; only stub the permission decision.
vi.mock("~/server/api/rbac", async (importActual) => {
  const actual = await importActual<typeof import("~/server/api/rbac")>();
  return { ...actual, hasProjectPermission: vi.fn().mockResolvedValue(true) };
});

const getRunState = vi.fn();
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

const managerAbort = vi.fn().mockResolvedValue(undefined);
vi.mock("~/server/experiments-v3/execution/abortManager", () => ({
  abortManager: { requestAbort: (...args: unknown[]) => managerAbort(...args) },
}));

const post = async (body: unknown) => {
  const { app } = await import("../experiments-v3");
  return app.request("/api/experiments/abort", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};

describe("POST /api/experiments/abort cross-tenant isolation", () => {
  beforeEach(() => {
    getRunState.mockReset();
    requestAbort.mockClear();
    managerAbort.mockClear();
  });

  describe("when the run belongs to a different project than the caller's", () => {
    /** @scenario "A resource id from the body is verified against the authenticated tenant" */
    it("returns 404 and does not signal an abort", async () => {
      getRunState.mockResolvedValue({ runId: "run_x", projectId: "project_OTHER" });

      const res = await post({ projectId: "project_MINE", runId: "run_x" });

      expect(res.status).toBe(404);
      expect(requestAbort).not.toHaveBeenCalled();
      expect(managerAbort).not.toHaveBeenCalled();
    });
  });

  describe("when the run does not exist", () => {
    it("returns 404 and does not signal an abort", async () => {
      getRunState.mockResolvedValue(null);

      const res = await post({ projectId: "project_MINE", runId: "run_missing" });

      expect(res.status).toBe(404);
      expect(requestAbort).not.toHaveBeenCalled();
    });
  });

  describe("when the run belongs to the caller's project", () => {
    it("signals the abort", async () => {
      getRunState.mockResolvedValue({ runId: "run_x", projectId: "project_MINE" });

      const res = await post({ projectId: "project_MINE", runId: "run_x" });

      expect(res.status).toBe(200);
      expect(requestAbort).toHaveBeenCalledWith("run_x");
      expect(managerAbort).toHaveBeenCalledWith("run_x");
    });
  });
});
