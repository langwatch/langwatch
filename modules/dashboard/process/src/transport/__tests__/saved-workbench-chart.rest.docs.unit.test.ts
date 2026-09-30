/**
 * What the saved workbench chart family publishes in the API document: one described operation
 * per route, each with a summary, a tag and a response schema.
 * @see specs/lwql/saved-charts.feature
 * @see specs/lwql/langy-authoring.feature
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { savedWorkbenchChartRest } from "../saved-workbench-chart.rest.ts";

const CHARTS = "/api/v1/projects/:projectId/analytics/charts";
const CHART_OPERATIONS = [
  ["get", CHARTS],
  ["post", CHARTS],
  ["get", `${CHARTS}/:chartId`],
  ["patch", `${CHARTS}/:chartId`],
  ["delete", `${CHARTS}/:chartId`],
] as const;
const PLACEMENT_OPERATIONS = [
  ["put", `${CHARTS}/:chartId/placement`],
  ["delete", `${CHARTS}/:chartId/placement`],
] as const;

describe("given the saved workbench chart REST family", () => {
  const routes = savedWorkbenchChartRest.router().routes;
  const publishedAs = (method: string, path: string) =>
    routes.find((route) => route.method === method && route.path === path);

  describe("when the API document is read for the chart paths", () => {
    /** @scenario "Every chart endpoint is published in the API document" */
    it.each(CHART_OPERATIONS)("describes %s %s with a summary, a tag and a response", (method, path) => {
      const route = publishedAs(method, path);

      expect(route, `${method} ${path} is not declared`).toBeDefined();
      expect(route?.docs?.summary).toBeTruthy();
      expect(route?.docs?.tags?.length).toBeGreaterThan(0);
      expect(Object.keys(route?.docs?.responses ?? {}).some((status) => status.startsWith("2"))).toBe(
        true,
      );
    });
  });

  describe("when the API document is read for the placement paths", () => {
    /** @scenario "The placement endpoints are published in the API document" */
    it.each(PLACEMENT_OPERATIONS)("describes %s %s with a summary, a tag and a response", (method, path) => {
      const route = publishedAs(method, path);

      expect(route, `${method} ${path} is not declared`).toBeDefined();
      expect(route?.docs?.summary).toBeTruthy();
      expect(route?.docs?.tags?.length).toBeGreaterThan(0);
      expect(Object.keys(route?.docs?.responses ?? {}).some((status) => status.startsWith("2"))).toBe(
        true,
      );
    });
  });
});
