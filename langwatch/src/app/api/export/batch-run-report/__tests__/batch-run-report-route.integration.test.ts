/**
 * Integration tests for the run report endpoint.
 *
 * The HTTP concerns only: who is allowed to ask, what gets recorded before
 * anything is produced, and what comes back. The report's contents are covered
 * by the service and render tests — what is under test here is that a report
 * cannot be obtained without permission and cannot be obtained silently.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportModel } from "~/server/export/batch-run-report/report.types";

const getServerAuthSession = vi.fn();
const hasProjectPermission = vi.fn();
const auditLog = vi.fn();
const generate = vi.fn();

vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) => getServerAuthSession(...args),
}));
vi.mock("~/server/auditLog", () => ({
  auditLog: (...args: unknown[]) => auditLog(...args),
}));
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ simulations: { report: { generate } } }),
}));
// Partial mock: the route uses only this helper, but other modules in the
// import graph read further rbac exports.
vi.mock(import("~/server/api/rbac"), async (importOriginal) => ({
  ...(await importOriginal()),
  hasProjectPermission: ((...args: unknown[]) =>
    hasProjectPermission(...args)) as never,
}));
vi.mock("~/server/db", () => ({ prisma: {} }));

const BODY = {
  projectId: "project_1",
  scenarioSetId: "set_1",
  batchRunId: "batch_1",
};

/**
 * Typed as `ReportModel` on purpose.
 *
 * As an untyped literal this drifted silently when `summary` was added to the
 * model: typecheck stayed green and the gap only surfaced as a 500 from the
 * renderer in CI. Annotated, the next field added to `ReportModel` breaks the
 * build here instead.
 */
function reportModel(overrides: Partial<ReportModel> = {}): ReportModel {
  return {
    meta: {
      projectId: "project_1",
      suiteName: "Checkout",
      batchRunId: "batch_1",
      generatedAt: "2026-07-29T12:00:00.000Z",
      withAnalysis: true,
    },
    summary: {
      verdict: "One of two scenarios failed.",
      tone: "warn",
      movement: null,
      facts: [{ label: "Scenarios", value: "2" }],
      topProblem: null,
      caveat: null,
    },
    tier: "figures_only",
    headline: {
      passRate: {
        value: 50,
        ci95: null,
        settled: 2,
        isTooFewToConclude: true,
        inconclusiveReason: "too_few_runs",
      },
      counts: {
        passedCount: 1,
        failedCount: 1,
        stalledCount: 0,
        cancelledCount: 0,
        inProgressCount: 0,
        queuedCount: 0,
        completedCount: 2,
        settledCount: 2,
        totalCount: 2,
      },
    },
    sections: [],
    integrity: {
      claimsDroppedUncited: 0,
      claimsDroppedUnresolvable: 0,
      claimsDroppedUnconfirmed: 0,
      notes: [],
    },
    ...overrides,
  };
}

async function post(body: unknown) {
  const { app } = await import("../[[...route]]/app");
  return app.request("/api/export/batch-run-report/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerAuthSession.mockResolvedValue({ user: { id: "user_1" } });
  hasProjectPermission.mockResolvedValue(true);
  auditLog.mockResolvedValue(undefined);
  generate.mockResolvedValue(reportModel());
});

describe("POST /api/export/batch-run-report/download authorization", () => {
  describe("when the caller has no session", () => {
    it("refuses the request", async () => {
      getServerAuthSession.mockResolvedValue(null);

      const response = await post(BODY);

      expect(response.status).toBe(401);
      expect(generate).not.toHaveBeenCalled();
    });
  });

  describe("when the caller cannot view scenarios in this project", () => {
    /** @scenario A report requires permission to view scenarios */
    it("denies with an authorization error and produces nothing", async () => {
      hasProjectPermission.mockResolvedValue(false);

      const response = await post(BODY);

      expect(response.status).toBe(403);
      expect(generate).not.toHaveBeenCalled();
    });

    /** @scenario A report is scoped to my own project */
    it("checks the permission against the project that was asked for", async () => {
      hasProjectPermission.mockResolvedValue(false);

      await post({ ...BODY, projectId: "someone_elses_project" });

      expect(hasProjectPermission).toHaveBeenCalledWith(
        expect.anything(),
        "someone_elses_project",
        "scenarios:view",
      );
    });
  });
});

describe("POST /api/export/batch-run-report/download delivery", () => {
  describe("when the report is produced", () => {
    /** @scenario Producing a report is recorded */
    it("records the request against the user before producing anything", async () => {
      const order: string[] = [];
      auditLog.mockImplementation(async () => {
        order.push("audit");
      });
      generate.mockImplementation(async () => {
        order.push("generate");
        return reportModel();
      });

      await post(BODY);

      expect(order).toEqual(["audit", "generate"]);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_1",
          projectId: "project_1",
          action: "scenarioRunReport.export",
        }),
      );
    });

    it("returns the report as an HTML attachment naming its tier", async () => {
      const response = await post(BODY);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/html");
      expect(response.headers.get("Content-Disposition")).toContain(
        "attachment",
      );
      expect(response.headers.get("X-Report-Tier")).toBe("figures_only");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(await response.text()).toContain("<!doctype html>");
    });

    // Content-Disposition's filename is a quoted string, so a quote in the
    // caller-supplied name would close it and let them append parameters.
    /** @scenario A run named with characters that break filenames still downloads */
    it("strips characters that would break out of the filename", async () => {
      const response = await post({
        ...BODY,
        suiteName: 'evil"; filename="hacked.exe',
      });
      const disposition = response.headers.get("Content-Disposition") ?? "";

      expect(response.status).toBe(200);
      expect(disposition).not.toContain('filename="hacked.exe');
      expect(disposition.match(/filename=/g)).toHaveLength(1);
    });
  });

  describe("when the run does not exist", () => {
    /** @scenario Asking for a run that does not exist is refused */
    it("answers not found rather than an empty report", async () => {
      const { BatchRunNotFoundError } = await import(
        "~/server/export/batch-run-report/batch-run-report.service"
      );
      generate.mockRejectedValue(new BatchRunNotFoundError("batch_1"));

      const response = await post(BODY);

      expect(response.status).toBe(404);
    });
  });
});
