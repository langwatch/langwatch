/**
 * @vitest-environment node
 * The monitors page's seven-day trend, read by evaluation since monitor stopped
 * depending on it: the window, the guardrail flag and the empty project.
 */
import type { MonitorPerformanceQuery } from "@langwatch/evaluation-contract";
import type { MonitorWithEvaluator } from "@langwatch/monitor-contract";
import { describe, expect, it } from "vitest";

import { previousPeriodStartMs } from "../../../../rules/monitor-performance-window.rules.ts";
import { MonitorTrendService } from "../monitor-trend.service.ts";

const PROJECT_ID = "project-1";

function trend(monitors: Partial<MonitorWithEvaluator>[]) {
  const queries: MonitorPerformanceQuery[] = [];
  const service = MonitorTrendService.create({
    monitors: { list: async () => monitors as MonitorWithEvaluator[] },
    performance: {
      getMonitorPerformance: async (query) => {
        queries.push(query);

        return [];
      },
    },
  });

  return { service, queries };
}

describe("given the monitors page reads its seven-day trend", () => {
  describe("when the project has no monitors", () => {
    it("answers with no rows rather than querying evaluations", async () => {
      const { service, queries } = trend([]);

      await expect(service.findForProject({ projectId: PROJECT_ID })).resolves.toEqual([]);
      expect(queries).toEqual([]);
    });
  });

  describe("when the project has a monitor", () => {
    /** @scenario "The monitors page's seven-day trend is read through evaluation" */
    it("compares against the window analytics resolves, in the reader's time zone", async () => {
      const { service, queries } = trend([{ id: "monitor-1", checkType: "langevals/llm_boolean" }]);

      await service.findForProject({ projectId: PROJECT_ID, timeZone: "Europe/Berlin" });

      expect(queries[0]).toMatchObject({
        tenantId: PROJECT_ID,
        monitors: [{ id: "monitor-1", isGuardrail: true }],
        timeZone: "Europe/Berlin",
      });
      const query = queries[0]!;
      expect(query.currentStartMs).toBe(query.endMs - 7 * 24 * 60 * 60 * 1000);
      expect(query.previousStartMs).toBe(
        previousPeriodStartMs({ startMs: query.currentStartMs, endMs: query.endMs }),
      );
    });

    it("reads the window in UTC when the reader names no time zone", async () => {
      const { service, queries } = trend([{ id: "monitor-1", checkType: "custom/unknown" }]);

      await service.findForProject({ projectId: PROJECT_ID });

      expect(queries[0]?.timeZone).toBe("UTC");
    });
  });
});
