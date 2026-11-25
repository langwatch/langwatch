import { buildExampleReportTemplateContext } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import { REPORT_TEMPLATE_VARIABLES } from "../model/report-variables.ts";

function exampleFor(sourceKind: "traceQuery" | "customGraph" | "dashboard") {
  return buildExampleReportTemplateContext({
    baseHost: "https://app.langwatch.ai",
    project: { name: "Acme", slug: "acme" },
    trigger: { name: "Weekly report" },
    sourceKind,
  });
}

describe("given the author is editing a report's message", () => {
  describe("when the preview is built for each source", () => {
    /** @scenario "The preview renders against report data" */
    it("carries example traces for a trace query and example charts for a graph or dashboard", () => {
      const traceReport = exampleFor("traceQuery");
      expect(traceReport.traces.length).toBeGreaterThan(0);
      expect(traceReport.charts).toHaveLength(0);
      expect(traceReport.report.isEmpty).toBe(false);

      for (const sourceKind of ["customGraph", "dashboard"] as const) {
        const chartReport = exampleFor(sourceKind);
        expect(chartReport.charts.length).toBeGreaterThan(0);
        expect(chartReport.charts[0]?.series[0]?.data.length).toBeGreaterThan(0);
        expect(chartReport.traces).toHaveLength(0);
        expect(chartReport.report.isEmpty).toBe(false);
      }
    });

    /** @scenario "The preview renders against report data" */
    it("offers the report's own variables, never another automation's", () => {
      const paths = REPORT_TEMPLATE_VARIABLES.map((variable) => variable.path);

      expect(paths).toEqual(expect.arrayContaining(["report.sourceLabel", "traces", "charts"]));
      expect(
        paths.filter((path) => path.startsWith("match.") || path.startsWith("alert.")),
      ).toEqual([]);
    });
  });
});
