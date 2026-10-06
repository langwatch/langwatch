/**
 * Every built catalogue widget stores a definition the widget schema accepts, reads
 * every query its code asks for, and sends an empty face to an allowlisted setup page.
 */

import { NAVIGABLE_TARGETS } from "@langwatch/analytics-contract/chart-frame-protocol";
import { describe, expect, it } from "vitest";

import { chartGridPlacementSchema } from "../../../../model/chart-grid.ts";
import { dashboardWidgetDefinitionSchema } from "../../../../model/dashboard-widget-definition.ts";
import { CATALOGUE_WIDGET_BUILDS, IMPLEMENTED_WIDGET_IDS, implementedWidget } from "../index.ts";

const built = IMPLEMENTED_WIDGET_IDS.flatMap((id) => implementedWidget(id) ?? []);
const tables = built.filter(({ definition }) => definition.code.includes("<table"));
const called = (code: string, fn: string) =>
  [...code.matchAll(new RegExp(`LW\\.${fn}\\("([^"]+)"`, "g"))].flatMap((match) => match[1] ?? []);

describe("given every built catalogue widget", () => {
  it("builds a stored widget for every build entry", () => {
    expect(built.map(({ key }) => key).toSorted()).toEqual(
      Object.keys(CATALOGUE_WIDGET_BUILDS).toSorted(),
    );
  });

  it("stores a definition the widget schema accepts, inside the grid", () => {
    for (const { key, definition, layout } of built) {
      expect(dashboardWidgetDefinitionSchema.validate(definition), key).toBe(true);
      expect(definition.queries.length, key).toBeLessThanOrEqual(8);
      expect(chartGridPlacementSchema.validate(layout), key).toBe(true);
    }
  });

  it("declares exactly the queries its code asks for", () => {
    for (const { key, definition } of built) {
      expect(definition.queries.map(({ name }) => name).toSorted(), key).toEqual(
        called(definition.code, "useChartQuery").toSorted(),
      );
    }
  });

  it("sends its empty face to an allowlisted setup page", () => {
    for (const { key, definition } of built) {
      const targets = called(definition.code, "navigate");
      expect(targets.length, key).toBeGreaterThan(0);
      for (const target of targets) expect(NAVIGABLE_TARGETS, key).toContain(target);
    }
  });

  /** @scenario "AC6 Template tables are shorter than template charts" */
  it("keeps every table widget at most 4 grid rows high", () => {
    expect(tables.length).toBeGreaterThan(0);
    for (const { key, layout } of tables) expect(layout.rowSpan, key).toBeLessThanOrEqual(4);
  });
});
