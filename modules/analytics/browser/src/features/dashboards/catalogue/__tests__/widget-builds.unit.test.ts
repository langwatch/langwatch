/**
 * Every built catalogue widget stores a definition the widget schema accepts, reads
 * every query its code asks for, sends an empty face to an allowlisted setup page,
 * carries its description outside its code and is tall enough for its empty face.
 */

import { NAVIGABLE_TARGETS } from "@langwatch/analytics-contract/chart-frame-protocol";
import { describe, expect, it } from "vitest";

import { chartGridPlacementSchema } from "../../../../model/chart-grid.ts";
import { dashboardWidgetDefinitionSchema } from "../../../../model/dashboard-widget-definition.ts";
import { BOARD_MIN_ROW_SPAN } from "../../model/board-grid.ts";
import { BOARD_TEMPLATES } from "../../templates/index.ts";
import {
  CATALOGUE_WIDGET_BUILDS,
  CATALOGUE_WIDGETS,
  IMPLEMENTED_WIDGET_IDS,
  implementedWidget,
} from "../index.ts";

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

  /** @scenario "AC110 Widget description: a built widget carries its description, not in its code" */
  it("stores its subtitle and why as the description, and its code no longer draws them", () => {
    for (const { key, definition } of built) {
      const subtitle = CATALOGUE_WIDGET_BUILDS[key]!.code.description;
      const why = CATALOGUE_WIDGETS.find(({ id }) => id === key)!.why;
      expect(definition.description, key).toBe(`${subtitle}\n\n${why}`);
      expect(definition.code, key).not.toContain(`>${subtitle}</div>`);
      expect(definition.code, key).not.toContain("color: C.faint, marginBottom: 8");
    }
  });

  /** @scenario "AC116 Widget fit: every built widget is at least the minimum height" */
  it("spans at least the board's minimum rows, on its own and in every template", () => {
    for (const { key, layout } of built) {
      expect(layout.rowSpan, key).toBeGreaterThanOrEqual(BOARD_MIN_ROW_SPAN);
    }
    for (const template of BOARD_TEMPLATES) {
      for (const { key, layout } of template.widgets) {
        expect(layout.rowSpan, `${template.id}/${key}`).toBeGreaterThanOrEqual(BOARD_MIN_ROW_SPAN);
      }
    }
  });
});
