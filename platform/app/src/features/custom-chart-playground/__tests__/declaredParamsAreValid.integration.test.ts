/**
 * @vitest-environment jsdom
 *
 * The Save gate's declared-parameter check. A parameter name starting with the
 * reserved `dashboard_context_` prefix is rejected by the persisted definition,
 * so the drawer must not let it through — flagging the row inline is not enough,
 * Save has to stay disabled.
 *
 * @see specs/analytics/custom-chart-playground.feature
 */

import { describe, expect, it } from "vitest";

import type { DashboardWidgetQuery } from "~/server/analytics/dashboardWidgetDefinition";
import { declaredParamsAreValid } from "../DashboardWidgetQueryParamsEditor";

const query = (
  parameters: DashboardWidgetQuery["parameters"],
): DashboardWidgetQuery => ({ name: "main", sql: "SELECT 1", parameters });

describe("declaredParamsAreValid", () => {
  describe("when every declared parameter name is ordinary", () => {
    it("is valid", () => {
      expect(
        declaredParamsAreValid([
          query([{ name: "threshold", type: "number" }]),
        ]),
      ).toBe(true);
    });
  });

  describe("when a query declares no parameters", () => {
    it("is valid", () => {
      expect(declaredParamsAreValid([query(undefined)])).toBe(true);
    });
  });

  describe("when a declared name uses the reserved dashboard_context_ prefix", () => {
    it("is invalid", () => {
      expect(
        declaredParamsAreValid([
          query([{ name: "dashboard_context_sneaky", type: "string" }]),
        ]),
      ).toBe(false);
    });
  });
});
