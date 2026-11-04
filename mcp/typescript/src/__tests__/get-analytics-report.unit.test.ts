import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initConfig } from "../config.ts";
import { LangWatchApiError } from "../langwatch-api.js";
import { handleGetAnalyticsReport } from "../tools/get-analytics-report.js";

const ENDPOINT = "https://app.example.com";
const report = {
  id: "report_1",
  name: "Quality",
  order: 0,
  graphCount: 1,
  graphs: [{ id: "g_1" }],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
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

describe("handleGetAnalyticsReport()", () => {
  describe("when the id is an Analytics Report", () => {
    /** @scenario "AC8c An agent reads a Dashboards board by its id" */
    it("returns it with its graphs from /api/v1/analytics/reports only", async () => {
      const urls = stubFetch({ status: 200, body: report });

      const result = await handleGetAnalyticsReport({ reportId: "report_1" });

      expect(urls).toEqual(["/api/v1/analytics/reports/report_1"]);
      expect(result).toContain("# Quality");
      expect(result).toContain("**Graphs**: 1");
    });
  });

  describe("when the id is a Dashboards dashboard", () => {
    /** @scenario "AC8c An agent reads a Dashboards board by its id" */
    it("fails with the not found error after exactly one request", async () => {
      const urls = stubFetch({ status: 404, body: { error: "Dashboard not found" } });

      const failure = await handleGetAnalyticsReport({ reportId: "dashboard_v2" }).catch(
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(LangWatchApiError);
      expect((failure as LangWatchApiError).status).toBe(404);
      expect(urls).toEqual(["/api/v1/analytics/reports/dashboard_v2"]);
    });
  });
});
