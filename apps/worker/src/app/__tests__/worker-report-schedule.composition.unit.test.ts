import { describe, expect, it, vi } from "vitest";
import { ComposedWorkerReportTraceList } from "../worker-report-schedule.composition";

const BASE_HOST = "https://app.langwatch.test";
const WINDOW = { from: 1_000, to: 2_000 };

function traceRow(overrides: Record<string, unknown> = {}) {
  return {
    traceId: "trace-a",
    timestamp: WINDOW.to,
    input: "Where is my order?",
    output: "It ships tomorrow.",
    models: ["gpt-5-mini"],
    status: "error",
    totalCost: 0.25,
    durationMs: 1234,
    ...overrides,
  };
}

describe("ComposedWorkerReportTraceList", () => {
  describe("given a report whose author wrote a search query", () => {
    it("reads the window's newest matching page and deep-links each row at the project", async () => {
      const getList = vi.fn(async () => ({ items: [traceRow()] }));
      const translateFilter = vi.fn(() => ({
        sql: "Status = {s:String}",
        params: { s: "error" },
      }));
      const traces = ComposedWorkerReportTraceList.create({
        traces: { getList },
        translateFilter,
        baseHost: BASE_HOST,
      });

      const rows = await traces.listReportTraces({
        projectId: "project-1",
        projectSlug: "checkout",
        query: "status:error",
        ...WINDOW,
        limit: 5,
      });

      expect(translateFilter).toHaveBeenCalledWith("status:error", "project-1", WINDOW);
      expect(getList).toHaveBeenCalledWith({
        tenantId: "project-1",
        timeRange: WINDOW,
        sort: { columnId: "time", direction: "desc" },
        page: 1,
        pageSize: 5,
        visibilityCutoffMs: null,
        filterWhere: { sql: "Status = {s:String}", params: { s: "error" } },
      });
      expect(rows).toEqual([
        expect.objectContaining({
          traceId: "trace-a",
          url: `${BASE_HOST}/checkout/traces/trace-a`,
          model: "gpt-5-mini",
          status: "error",
          costUsd: 0.25,
          durationMs: 1234,
        }),
      ]);
    });
  });

  describe("given a report whose author wrote no search query", () => {
    it("reads the whole window rather than a predicate that matches nothing", async () => {
      const requests: Array<Record<string, unknown>> = [];
      const getList = vi.fn(async (params: Record<string, unknown>) => {
        requests.push(params);
        return { items: [] };
      });
      const traces = ComposedWorkerReportTraceList.create({
        traces: { getList },
        // An empty query compiles to no predicate — that is what "everything in
        // the window" means to the reader.
        translateFilter: () => null,
        baseHost: BASE_HOST,
      });

      await traces.listReportTraces({
        projectId: "project-1",
        projectSlug: "checkout",
        query: "",
        ...WINDOW,
        limit: 5,
      });

      expect(requests[0]).not.toHaveProperty("filterWhere");
    });
  });
});
