/**
 * `POST /api/export/scenario-runs/download` streams application-owned gzip bytes.
 * @vitest-environment node
 */
import { gzipSync, gunzipSync } from "node:zlib";

import { createApiFixture } from "@langwatch/api-fixture";
import { createRestRuntime, type RestErrorHandler } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";

import { scenarioRunExportRest } from "../scenario-run-export.rest.ts";

const boundaryErrorHandler: RestErrorHandler = (error, context) => {
  if (HandledError.isHandled(error)) {
    return context.json({ code: error.code }, (error.httpStatus ?? 500) as ContentfulStatusCode);
  }

  return context.json({ error: "internal_server_error" }, 500);
};

function buildApi(permitted = true) {
  const compressed = gzipSync("ScenarioRunId\r\nrun_1\r\n");
  const downloadScenarioRunExport = vi.fn<ScenarioApi["downloadScenarioRunExport"]>(async () => ({
    exportId: "export_1",
    filename: "project_1 - Scenario Runs - 2026-09-18 - full.csv",
    totalCount: 1,
    stream: (async function* () {
      yield compressed;
    })(),
    cancel: async () => {},
  }));
  const app = createApiFixture<ScenarioApi>({ downloadScenarioRunExport });
  const authorize = vi.fn(() => ({ permitted, organizationRole: null }));
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: null }),
      identify: () => ({ actor: { type: "user", id: "user_1" }, scope: null }),
      authorize,
    },
  });
  const hono = runtime.mount(scenarioRunExportRest.router(), {
    app: () => app,
    onError: boundaryErrorHandler,
  });
  const download = (projectId = "project_1") =>
    hono.request("http://api.test/api/export/scenario-runs/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, mode: "full" }),
    });

  return { authorize, download, downloadScenarioRunExport };
}

describe("POST /api/export/scenario-runs/download", () => {
  describe("given the caller may view the body project", () => {
    /** @scenario "The download is compressed in transit" */
    it("preserves gzip bytes and the download metadata from ScenarioApi", async () => {
      const { authorize, download, downloadScenarioRunExport } = buildApi();

      const response = await download("project_other");
      const bytes = new Uint8Array(await response.arrayBuffer());

      expect(response.status).toBe(200);
      expect(response.headers.get("content-encoding")).toBe("gzip");
      expect(response.headers.get("content-disposition")).toContain(
        'filename="project_1 - Scenario Runs - 2026-09-18 - full.csv"',
      );
      expect(response.headers.get("x-export-id")).toBe("export_1");
      expect(response.headers.get("x-total-runs")).toBe("1");
      expect(gunzipSync(bytes).toString()).toBe("ScenarioRunId\r\nrun_1\r\n");
      expect(downloadScenarioRunExport).toHaveBeenCalledWith(
        expect.objectContaining({
          request: { projectId: "project_other", mode: "full" },
          userId: "user_1",
        }),
      );
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          permission: "scenarios:view",
          target: { tier: "project", id: "project_other" },
        }),
      );
    });
  });

  describe("given the caller lacks scenarios:view on the body project", () => {
    /** @scenario "Export requires permission to view scenarios" */
    it("refuses before opening the application export", async () => {
      const { authorize, download, downloadScenarioRunExport } = buildApi(false);

      const response = await download();

      expect(response.status).toBe(403);
      expect(downloadScenarioRunExport).not.toHaveBeenCalled();
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          permission: "scenarios:view",
          target: { tier: "project", id: "project_1" },
        }),
      );
    });
  });
});
