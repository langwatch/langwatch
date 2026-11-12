import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initConfig } from "../config.ts";
import { LangWatchApiError } from "../langwatch-api.js";
import { handleGetDashboard } from "../tools/dashboards.js";

const ENDPOINT = "https://app.example.com";
const dashboard = {
  id: "dashboard_v2",
  name: "Ops dashboard",
  description: null,
  scope: "PROJECT",
  createdById: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
  platformUrl: "https://app.langwatch.ai/p/dashboards/dashboard_v2",
};

function stubFetch({ status, body }: { status: number; body: unknown }) {
  const urls: string[] = [];
  globalThis.fetch = vi.fn(async (url: string) => {
    urls.push(url.slice(ENDPOINT.length));
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return urls;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  initConfig({ apiKey: "test-key", endpoint: ENDPOINT });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("handleGetDashboard()", () => {
  describe("when the id is a Dashboards dashboard", () => {
    /** @scenario "AC8c An agent reads a Dashboards board by its id" */
    it("returns its name, id and link from /api/v1/dashboards only", async () => {
      const urls = stubFetch({ status: 200, body: dashboard });

      const result = await handleGetDashboard({ dashboardId: "dashboard_v2" });

      expect(urls).toEqual(["/api/v1/dashboards/dashboard_v2"]);
      expect(result).toContain("# Ops dashboard");
      expect(result).toContain("**ID**: dashboard_v2");
      expect(result).toContain(dashboard.platformUrl);
    });
  });

  describe("when the id is an Analytics Report", () => {
    /** @scenario "AC8c An agent reads a Dashboards board by its id" */
    it("fails with the not found error after exactly one request", async () => {
      const urls = stubFetch({ status: 404, body: { error: "Dashboard not found" } });

      const failure = await handleGetDashboard({ dashboardId: "report_1" }).catch(
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(LangWatchApiError);
      expect((failure as LangWatchApiError).status).toBe(404);
      expect(urls).toEqual(["/api/v1/dashboards/report_1"]);
    });
  });

  describe("when the dashboard route fails another way", () => {
    it("reports that failure with no second request", async () => {
      const urls = stubFetch({ status: 500, body: { error: "boom" } });

      await expect(handleGetDashboard({ dashboardId: "x" })).rejects.toBeInstanceOf(
        LangWatchApiError,
      );
      expect(urls).toHaveLength(1);
    });
  });
});
