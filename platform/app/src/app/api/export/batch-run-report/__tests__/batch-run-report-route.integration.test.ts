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
vi.mock("@ee/audit-log/auditLog", () => ({
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
const checkReportRateLimit = vi.fn();
vi.mock("~/server/export/batch-run-report/report-rate-limit", () => ({
  checkReportRateLimit: (...args: unknown[]) => checkReportRateLimit(...args),
}));

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

async function post(body: unknown, query = "") {
  const { app } = await import("../[[...route]]/app");
  return app.request(`/api/export/batch-run-report/download${query}`, {
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
  checkReportRateLimit.mockResolvedValue({
    isAllowed: true,
    retryAfterSeconds: 0,
  });
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
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(403);
      expect(body.error).toBe("scenario_run_export_forbidden");
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
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(404);
      expect(body.error).toBe("scenario_batch_run_not_found");
    });
  });
});

/**
 * The path every real export takes.
 *
 * `useBatchRunReport` always appends `?stream=1`, so the buffered branch above
 * is exercised by nothing a user does. Tested separately because a stream
 * cannot report a failure the way a status code does - the headers are gone
 * by the time `generate()` runs - so what a caller can act on is the shape of
 * the last line, not the response code.
 */
describe("POST /api/export/batch-run-report/download?stream=1", () => {
  async function lines(response: Response): Promise<Record<string, unknown>[]> {
    return (await response.text())
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  describe("when the report is produced", () => {
    it("streams each stage, then the document on the last line", async () => {
      generate.mockImplementation(
        async ({ onProgress }: { onProgress: (stage: string) => void }) => {
          onProgress("reading");
          onProgress("rendering");
          return reportModel();
        },
      );

      const response = await post(BODY, "?stream=1");
      const events = await lines(response);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain(
        "application/x-ndjson",
      );
      expect(events.slice(0, 2).map((it) => it.stage)).toEqual([
        "reading",
        "rendering",
      ]);

      const last = events.at(-1);
      expect(last?.done).toBe(true);
      expect(last?.tier).toBe("figures_only");
      expect(String(last?.html)).toContain("<!doctype html>");
      expect(String(last?.filename)).toMatch(/\.html$/);
    });
  });

  describe("when the run does not exist", () => {
    /** @scenario Asking for a run that does not exist is refused */
    it("ends the stream with an error rather than a document", async () => {
      const { BatchRunNotFoundError } = await import(
        "~/server/export/batch-run-report/batch-run-report.service"
      );
      generate.mockRejectedValue(new BatchRunNotFoundError("batch_1"));

      const events = await lines(await post(BODY, "?stream=1"));

      expect(events.at(-1)).toEqual({ error: "scenario_batch_run_not_found" });
      expect(events.some((it) => it.done)).toBe(false);
    });
  });

  describe("when producing the report throws", () => {
    /** @scenario A failure part-way through producing the report still names itself */
    it("names the failure with a code and leaks nothing of the reason", async () => {
      generate.mockRejectedValue(new Error("ClickHouse said no: dsn=secret"));

      const response = await post(BODY, "?stream=1");
      const events = await lines(response);

      // Reading to completion returned at all, which is the close: a
      // controller nobody shut leaves the reader waiting forever.
      expect(events.at(-1)).toEqual({ error: "export_failed" });
      expect(events.filter((it) => it.error)).toHaveLength(1);
      expect(JSON.stringify(events)).not.toContain("secret");
    });
  });

  describe("when the caller cannot view scenarios in this project", () => {
    /** @scenario A report requires permission to view scenarios */
    it("is refused before the stream opens", async () => {
      hasProjectPermission.mockResolvedValue(false);

      const response = await post(BODY, "?stream=1");

      expect(response.status).toBe(403);
      expect(generate).not.toHaveBeenCalled();
    });
  });
});

/**
 * Only the analysed path costs anything worth limiting: two model calls over
 * up to twenty-four transcripts, running for a minute or more. The instant
 * one is arithmetic, and refusing it would be friction with nothing behind it.
 */
describe("POST /api/export/batch-run-report/download rate limiting", () => {
  describe("when the limit is reached and Langy was asked for", () => {
    it("refuses and produces nothing", async () => {
      checkReportRateLimit.mockResolvedValue({
        isAllowed: false,
        retryAfterSeconds: 42,
      });

      const response = await post({ ...BODY, withAnalysis: true });

      expect(response.status).toBe(429);
      expect(generate).not.toHaveBeenCalled();
      expect(auditLog).not.toHaveBeenCalled();
    });

    /** @scenario A refusal names what went wrong rather than describing it */
    it("carries the code and the wait rather than a sentence", async () => {
      checkReportRateLimit.mockResolvedValue({
        isAllowed: false,
        retryAfterSeconds: 5,
      });

      const body = (await post({ ...BODY, withAnalysis: true }).then((r) =>
        r.json(),
      )) as { error: string; retryAfterSeconds?: number };

      // The code is what the interface has words for; the wait is the meta
      // those words read. Neither is prose the caller has to parse.
      expect(body.error).toBe("scenario_run_report_rate_limited");
      expect(body.retryAfterSeconds).toBe(5);
    });
  });

  describe("when the analysis was not asked for", () => {
    it("is never limited", async () => {
      checkReportRateLimit.mockResolvedValue({
        isAllowed: false,
        retryAfterSeconds: 42,
      });

      const response = await post({ ...BODY, withAnalysis: false });

      expect(response.status).toBe(200);
      expect(checkReportRateLimit).not.toHaveBeenCalled();
      expect(generate).toHaveBeenCalled();
    });
  });
});
