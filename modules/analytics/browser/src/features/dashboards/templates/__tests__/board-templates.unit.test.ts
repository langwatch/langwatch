/**
 * Every board template's shape: stored widgets that each parse as a widget
 * definition, unique keys, layouts inside the grid that never overlap, and a
 * not-connected face that sends the member to an allowlisted setup page.
 */

import { NAVIGABLE_TARGETS } from "@langwatch/analytics-contract/chart-frame-protocol";
import { describe, expect, it } from "vitest";

import { CHART_GRID_COLUMNS, chartGridPlacementSchema } from "../../../../model/chart-grid.ts";
import { dashboardWidgetDefinitionSchema } from "../../../../model/dashboard-widget-definition.ts";
import { BLOCK_QUESTION_SECTIONS } from "../../model/block-questions.ts";
import { AGENT_FLIGHT_DECK_TEMPLATE, BOARD_TEMPLATES, type BoardTemplateWidget } from "../index.ts";

/** Every grid cell a layout covers, as "column:row". */
function cellsOf({ gridColumn, gridRow, colSpan, rowSpan }: BoardTemplateWidget["layout"]) {
  return Array.from({ length: colSpan * rowSpan }, (_, index) => {
    const column = gridColumn + (index % colSpan);
    const row = gridRow + Math.floor(index / colSpan);
    return `${column}:${row}`;
  });
}

/** The route keys a widget's code hands to `LW.navigate`. */
function navigateTargets(code: string): string[] {
  return [...code.matchAll(/LW\.navigate\("([^"]+)"/g)].map((match) => match[1]!);
}

describe("BOARD_TEMPLATES", () => {
  /** @scenario "AC28 Each question group of the picker is also a template" */
  it("lists the Flight Deck, then one template per picker section in picker order", () => {
    expect(BOARD_TEMPLATES.map(({ id }) => id)).toEqual([
      AGENT_FLIGHT_DECK_TEMPLATE.id,
      ...BLOCK_QUESTION_SECTIONS.map(({ id }) => id),
    ]);
    expect(BOARD_TEMPLATES.slice(1).map(({ name }) => name)).toEqual(
      BLOCK_QUESTION_SECTIONS.map(({ title }) => title),
    );
  });

  /** @scenario "AC28 Each question group of the picker is also a template" */
  it("names each question group's template with the section's title and why-line", () => {
    for (const section of BLOCK_QUESTION_SECTIONS) {
      const template = BOARD_TEMPLATES.find(({ id }) => id === section.id);
      expect(template?.name, section.id).toBe(section.title);
      expect(template?.description, section.id).toBe(section.why);
    }
  });

  /** @scenario "AC28 Each question group of the picker is also a template" */
  it("gives each question group's template at least one widget per question in the group", () => {
    for (const section of BLOCK_QUESTION_SECTIONS) {
      const template = BOARD_TEMPLATES.find(({ id }) => id === section.id);
      expect(template?.widgets.length ?? 0, section.id).toBeGreaterThanOrEqual(
        section.questions.length,
      );
    }
  });

  it("gives every template a unique id", () => {
    expect(new Set(BOARD_TEMPLATES.map(({ id }) => id)).size).toBe(BOARD_TEMPLATES.length);
  });

  it("keeps the Flight Deck's ten widgets", () => {
    expect(AGENT_FLIGHT_DECK_TEMPLATE.widgets).toHaveLength(10);
  });

  /** @scenario "AC4 The ten widgets in prototype order" */
  it("orders the Flight Deck's widgets as the prototype does, full-width or paired", () => {
    const FULL_WIDTH = new Set([
      "Status",
      "Throughput, latency & errors",
      "Your coding agents",
      "Most impactful traces",
    ]);

    expect(AGENT_FLIGHT_DECK_TEMPLATE.widgets.map(({ name }) => name)).toEqual([
      "Status",
      "Throughput, latency & errors",
      "Cost efficiency",
      "Failure intelligence",
      "Scenario results",
      "Quality signal",
      "User feedback",
      "Gateway routing",
      "Your coding agents",
      "Most impactful traces",
    ]);

    for (const { name, layout } of AGENT_FLIGHT_DECK_TEMPLATE.widgets) {
      const expectedSpan = FULL_WIDTH.has(name) ? CHART_GRID_COLUMNS : CHART_GRID_COLUMNS / 2;
      expect(layout.colSpan, name).toBe(expectedSpan);
    }
  });

  /** @scenario "AC4 The ten widgets in prototype order" */
  it("shows each Flight Deck widget's own subtitle in its stored code", () => {
    const SUBTITLES: Record<string, string> = {
      Status: "Traffic, quality, latency and cost at a glance",
      "Throughput, latency & errors": "Correlate traffic spikes with degradation",
      "Cost efficiency": "What the spend buys",
      "Failure intelligence": "Top error categories in the window",
      "Scenario results": "How much behaviour your scenario suites exercise",
      "Quality signal": "Evaluator pass rate over time, against the error rate",
      "User feedback": "What users think of the answers",
      "Gateway routing": "Cost broken down by virtual key / route",
      "Your coding agents": "Sessions, spend and success across Claude Code, Cursor and Codex",
      "Most impactful traces":
        "Ranked by blended impact: errors, extreme latency, cost, negative feedback",
    };

    for (const { name, definition } of AGENT_FLIGHT_DECK_TEMPLATE.widgets) {
      expect(definition.code, name).toContain(SUBTITLES[name]);
    }
  });

  describe.each(BOARD_TEMPLATES.map((template) => [template.name, template] as const))(
    "given the %s template",
    (_, { widgets }) => {
      it("holds at least one widget", () => {
        expect(widgets.length).toBeGreaterThan(0);
      });

      it("gives every widget a unique key", () => {
        expect(new Set(widgets.map((widget) => widget.key)).size).toBe(widgets.length);
      });

      it("stores every widget as a definition the widget schema accepts", () => {
        for (const widget of widgets) {
          expect(dashboardWidgetDefinitionSchema.safeParse(widget.definition).success).toBe(true);
          expect(widget.definition.queries.length).toBeLessThanOrEqual(8);
        }
      });

      it("places every widget inside the grid", () => {
        for (const { layout } of widgets) {
          expect(chartGridPlacementSchema.safeParse(layout).success).toBe(true);
          expect(layout.gridColumn + layout.colSpan).toBeLessThanOrEqual(CHART_GRID_COLUMNS);
        }
      });

      it("never places two widgets on the same cell", () => {
        const cells = widgets.flatMap((widget) => cellsOf(widget.layout));
        expect(new Set(cells).size).toBe(cells.length);
      });

      /** @scenario "AC28 Each question group of the picker is also a template" */
      it("shows every widget's not-connected face with an allowlisted setup button", () => {
        for (const { name, definition } of widgets) {
          expect(definition.code, name).toContain("<CallToAction />");
          const targets = navigateTargets(definition.code);
          expect(targets.length, name).toBeGreaterThan(0);
          for (const target of targets) expect(NAVIGABLE_TARGETS).toContain(target);
        }
      });

      /** @scenario "AC28 Each question group of the picker is also a template" */
      it("reads every query the widget's code asks for", () => {
        for (const { name, definition } of widgets) {
          const asked = [...definition.code.matchAll(/LW\.useChartQuery\("([^"]+)"/g)];
          const names = definition.queries.map((query) => query.name);
          expect(new Set(names), name).toEqual(new Set(asked.map((match) => match[1])));
          expect(names.length, name).toBe(asked.length);
        }
      });
    },
  );
});
