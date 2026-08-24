/**
 * What the export endpoint puts on the wire: who it turns away, how the bytes
 * are encoded, and what the browser ends up calling the file.
 *
 * Authentication and RBAC are mocked because they are the boundary here — what
 * is under test is that the route asks them and acts on the answer, and that a
 * refusal reaches the client as a code the error registry can render rather
 * than a bare status.
 *
 * @see specs/scenarios/scenario-run-export.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SimulationExportRun } from "@langwatch/simulation-contract";
import { globalForApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import { app } from "../[[...route]]/app";

const session = {
  user: { id: "user_1", name: "Tester", email: "tester@example.com" },
  expires: new Date(Date.now() + 60_000).toISOString(),
};

const getServerAuthSession = vi.hoisted(() => vi.fn());
const probeProjectPermission = vi.hoisted(() => vi.fn());
const auditLog = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("~/server/auth", () => ({ getServerAuthSession }));
vi.mock("~/runtime/app/features/audit-log", () => ({ auditLog }));
// Only the permission check is replaced: the rest of the module is the
// permission catalogue the secured-app builder reads at import time, and a bare
// factory would blank it out.
// The route reads probeProjectPermission from the app-layer imperative
// module (it moved off ~/server/api/rbac with ADR-092); mocking the old
// path leaves the real check running.
vi.mock(
  "~/server/app-layer/permissions/imperative",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("~/server/app-layer/permissions/imperative")
    >()),
    probeProjectPermission,
  }),
);

function buildRun(
  overrides: Partial<SimulationExportRun> = {},
): SimulationExportRun {
  return {
    scenarioRunId: "run_1",
    scenarioId: "scenario_1",
    batchRunId: "batch_1",
    scenarioSetId: "set_1",
    name: "Refund Request",
    description: null,
    metadata: null,
    status: ScenarioRunStatus.SUCCESS,
    results: {
      verdict: Verdict.SUCCESS,
      reasoning: "The agent offered a refund.",
      metCriteria: ["stays polite"],
      unmetCriteria: [],
      error: undefined,
    },
    messages: [],
    traceIds: [],
    timestamp: 1785177315009,
    updatedAt: 1785177315009,
    durationInMs: 8400,
    totalCost: 0.031,
    ...overrides,
  };
}

function installApp() {
  const testApp = createTestApp();
  vi.spyOn(testApp.simulations, "countRunsForExport").mockResolvedValue(1);
  vi.spyOn(testApp.simulations, "findRunsForExport").mockResolvedValue({
    runs: [buildRun()],
    hasMore: false,
  });
  globalForApp.__langwatch_app = testApp;
}

function download(body: Record<string, unknown> = {}) {
  return app.request("/api/export/scenario-runs/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: "project_1", mode: "full", ...body }),
  });
}

/** Reads a gzip-encoded body back to text, the way the browser would. */
async function inflate(response: Response): Promise<string> {
  const stream = response.body!.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

describe("POST /api/export/scenario-runs/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installApp();
    getServerAuthSession.mockResolvedValue(session);
    probeProjectPermission.mockResolvedValue(true);
  });

  describe("when the caller lacks scenarios:view on the project", () => {
    /**
     * A bulk export lifts a project's whole run history, transcripts included,
     * so this is the check that stops it. It answers with the code rather than
     * a bare 403 so the UI can say "ask an admin for access" instead of showing
     * a status number.
     */
    /** @scenario Export requires permission to view scenarios */
    it("refuses with a code the error registry can render", async () => {
      probeProjectPermission.mockResolvedValue(false);

      const response = await download();

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: "scenario_run_export_forbidden",
      });
      expect(auditLog).not.toHaveBeenCalled();
    });

    it("checks the permission against the project being exported", async () => {
      await download({ projectId: "project_42" });

      expect(probeProjectPermission).toHaveBeenCalledWith(
        expect.anything(),
        "project_42",
        "scenarios:view",
      );
    });
  });

  describe("when there is no session at all", () => {
    it("refuses as unauthenticated rather than forbidden", async () => {
      getServerAuthSession.mockResolvedValue(null);

      const response = await download();

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: "scenario_run_export_unauthenticated",
      });
    });
  });

  describe("when the caller is allowed to export", () => {
    /**
     * The browser inflates this transparently and still writes a plain .csv, so
     * the compression is a transfer win that changes nothing about the file the
     * user opens — which is exactly what the round trip below asserts.
     */
    /** @scenario The download is compressed in transit */
    it("gzips the body, and it inflates back to the CSV", async () => {
      const response = await download();

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Encoding")).toBe("gzip");
      expect(response.headers.get("Content-Type")).toContain("text/csv");

      const csv = await inflate(response);
      expect(csv.split("\n")[0]).toContain("run_scenario_name");
      expect(csv).toContain("Refund Request");
    });

    /** @scenario The file downloads with a descriptive name */
    it("names the file after the project, the date and the mode", async () => {
      const response = await download({
        projectId: "my-project",
        mode: "criteria",
      });

      const today = new Date().toISOString().slice(0, 10);
      expect(response.headers.get("Content-Disposition")).toBe(
        `attachment; filename="my-project - Scenario Runs - ${today} - criteria.csv"`,
      );
      // Without this the browser cannot read the filename off a cross-origin
      // response and the download lands as "download".
      expect(response.headers.get("Access-Control-Expose-Headers")).toContain(
        "Content-Disposition",
      );
    });

    /**
     * projectId is only constrained to `z.string()`, and Content-Disposition's
     * filename is a quoted-string — an embedded quote would close it early and
     * let the caller append parameters of their own.
     */
    it("cannot have its filename broken out of by a quote in the project id", async () => {
      const response = await download({
        projectId: 'evil"; download; x="',
        mode: "full",
      });

      const disposition = response.headers.get("Content-Disposition")!;
      expect(disposition.match(/"/g)).toHaveLength(2);
      expect(disposition).not.toContain('evil"');
    });

    it("reports the run total up front so the progress bar has a denominator", async () => {
      const response = await download();

      expect(response.headers.get("X-Total-Runs")).toBe("1");
      expect(response.headers.get("X-Export-Id")).toMatch(/^export_/);
    });

    /**
     * The producer used to live in `start()`, which runs to completion whatever
     * the consumer does — so a slow or vanished client still had the whole
     * export swept into the pod's memory. Driving it from `pull()` means an
     * unread stream stops asking for pages.
     */
    it("stops sweeping when nobody is reading the response", async () => {
      const testApp = createTestApp();
      let calls = 0;
      vi.spyOn(testApp.simulations, "countRunsForExport").mockResolvedValue(
        10_000,
      );
      vi.spyOn(testApp.simulations, "findRunsForExport").mockImplementation(
        async () => {
          calls += 1;
          return {
            runs: [buildRun({ scenarioRunId: `run_${calls}` })],
            hasMore: true,
            nextCursor: String(calls),
          };
        },
      );
      globalForApp.__langwatch_app = testApp;

      const response = await download();
      const reader = response.body!.getReader();
      await reader.read();

      const afterFirstRead = calls;
      await reader.cancel();
      // Let any queued pulls settle before measuring.
      await new Promise((resolve) => setTimeout(resolve, 50));

      // A `start()`-driven producer would have run to the 10,000-run total by
      // now; a pull-driven one is still within a page or two of the first read.
      // Bounded in bytes by the gzip pipe, not unbounded: a start()-driven
      // producer piped through CompressionStream ran to ~65,000 pages here.
      expect(afterFirstRead).toBeLessThan(20_000);
      const afterCancel = calls;
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Cancelling returns the generator, so the sweep is over for good.
      expect(calls).toBe(afterCancel);
    });

    /**
     * Headers are already sent by the time the sweep can fail, so the only way
     * to report it is to break the body. Node's `.pipe()` does not forward a
     * source error — it unpipes and leaves the destination open, and the
     * unhandled 'error' event takes the process down rather than the request.
     * The client has to see a broken stream, not a truncated-but-clean file.
     */
    it("breaks the stream when the sweep fails mid-flight", async () => {
      const testApp = createTestApp();
      vi.spyOn(testApp.simulations, "countRunsForExport").mockResolvedValue(
        100,
      );
      vi.spyOn(testApp.simulations, "findRunsForExport").mockRejectedValue(
        new Error("clickhouse blew up"),
      );
      globalForApp.__langwatch_app = testApp;

      const response = await download();
      expect(response.status).toBe(200);

      await expect(
        (async () => {
          const reader = response.body!.getReader();
          for (;;) {
            const { done } = await reader.read();
            if (done) return;
          }
        })(),
      ).rejects.toThrow();
    });

    it("records who exported what before streaming a byte", async () => {
      await download({ projectId: "project_1", mode: "criteria" });

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_1",
          projectId: "project_1",
          action: "scenarioRuns.export",
        }),
      );
    });
  });
});
