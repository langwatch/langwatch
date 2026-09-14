/**
 * The four governance widget definitions, held against the product's own
 * dashboard widget format.
 *
 * These widgets are authored in the repository rather than saved by a reader,
 * which is exactly why they are checked here: nothing writes them, so no
 * router-side validation ever sees them, and a definition that drifted out of
 * the persisted format would still render on this page while being impossible
 * to save anywhere else. The page would then be demonstrating a private
 * dialect of the format instead of the format.
 *
 * Placement is checked against `chartGridPlacementSchema` and
 * `fitsChartGridWidth` — the same unit the grid persists and the routers
 * validate — rather than against arithmetic written out here. `gridColumn` is
 * zero-based in that unit (`0..CHART_GRID_COLUMNS - 1`), so a widget on the
 * left edge sits at column 0, and a full-width widget is `0 + 8 <= 8`.
 *
 * @see specs/governance/governance-dashboards.feature
 */
import { describe, expect, it } from "vitest";

import {
  CHART_GRID_COLUMNS,
  chartGridPlacementSchema,
  fitsChartGridWidth,
} from "~/server/analytics/chartGrid";
import {
  dashboardWidgetDefinitionSchema,
  validateDashboardWidgetQueryParams,
} from "~/server/analytics/dashboardWidgetDefinition";

import { GOVERNANCE_WIDGETS } from "../governanceWidgets";

/** The widgets this page draws, in the order the grid lays them out. */
const EXPECTED = [
  { id: "provider_day", name: "Spend over time by provider" },
  { id: "department", name: "Cost by department" },
  { id: "person", name: "Cost by person" },
  { id: "model_agent", name: "Cost by model and agent" },
] as const;

/** Two placements share at least one cell. */
const overlaps = (
  a: { gridColumn: number; gridRow: number; colSpan: number; rowSpan: number },
  b: { gridColumn: number; gridRow: number; colSpan: number; rowSpan: number },
): boolean =>
  a.gridColumn < b.gridColumn + b.colSpan &&
  b.gridColumn < a.gridColumn + a.colSpan &&
  a.gridRow < b.gridRow + b.rowSpan &&
  b.gridRow < a.gridRow + a.rowSpan;

const widgetById = (id: string) =>
  GOVERNANCE_WIDGETS.find((widget) => widget.id === id);

describe("the governance dashboard widgets", () => {
  describe("given the page's widget list is read", () => {
    /** @scenario "Every widget definition is a valid dashboard widget" */
    it("holds exactly the four widgets, named and ordered", () => {
      expect(
        GOVERNANCE_WIDGETS.map((widget) => ({
          id: widget.id,
          name: widget.name,
        })),
      ).toEqual(EXPECTED.map((widget) => ({ ...widget })));
    });
  });

  describe("given each definition is held against the persisted format", () => {
    /** @scenario "Every widget definition is a valid dashboard widget" */
    it("is accepted by the dashboard widget schema unchanged", () => {
      // A guard that asserts over an empty list passes while checking
      // nothing, so the count is the precondition, not a second opinion.
      expect(GOVERNANCE_WIDGETS.length).toBe(4);

      for (const widget of GOVERNANCE_WIDGETS) {
        expect(() =>
          dashboardWidgetDefinitionSchema.parse(widget.definition),
        ).not.toThrow();
      }
    });

    /** @scenario "Every widget definition is a valid dashboard widget" */
    it("declares queries a caller can run with no bound parameters", () => {
      // The page binds nothing of its own: the window and granularity are the
      // dashboard context, which the executor supplies. A query declaring a
      // required parameter would therefore never be answerable here.
      for (const widget of GOVERNANCE_WIDGETS) {
        for (const query of widget.definition.queries) {
          expect(
            validateDashboardWidgetQueryParams({ query, params: {} }),
          ).toEqual({ ok: true, params: {} });
        }
      }
    });
  });

  describe("given a widget's code has to reach its own query", () => {
    /** @scenario "Every widget definition is a valid dashboard widget" */
    it("names one query per widget, after the widget itself", () => {
      expect(
        GOVERNANCE_WIDGETS.map((widget) =>
          widget.definition.queries.map((query) => query.name),
        ),
      ).toEqual(EXPECTED.map((widget) => [widget.id]));
    });

    /** @scenario "Every widget definition is a valid dashboard widget" */
    it("gives every query across the four a name of its own", () => {
      const names = GOVERNANCE_WIDGETS.flatMap((widget) =>
        widget.definition.queries.map((query) => query.name),
      );

      expect(new Set(names).size).toBe(names.length);
    });

    /** @scenario "Every widget definition is a valid dashboard widget" */
    it("reads that query by name from the widget's own code", () => {
      // A widget whose code asks for a query the definition does not carry
      // draws nothing at runtime and fails no schema — the name has to be
      // held against the code, not just declared beside it.
      for (const widget of GOVERNANCE_WIDGETS) {
        for (const query of widget.definition.queries) {
          expect(widget.definition.code).toContain(
            `LW.useChartQuery("${query.name}"`,
          );
        }
      }
    });
  });

  describe("given every query reads a tenant's own figures over the page window", () => {
    /** @scenario "Every widget definition is a valid dashboard widget" */
    it("keys every read on the tenant and spans the selected range", () => {
      for (const widget of GOVERNANCE_WIDGETS) {
        for (const query of widget.definition.queries) {
          expect(query.sql).toContain("TenantId");
          expect(query.sql).toContain("dashboard_context_period_start");
          expect(query.sql).toContain("dashboard_context_period_end");
        }
      }
    });

    /** @scenario "Every widget definition is a valid dashboard widget" */
    it("buckets the over-time widget by the page's own granularity", () => {
      // The other three are one bar per group over the whole window; only the
      // time series has a bucket size to take from the dashboard context.
      expect(widgetById("provider_day")?.definition.queries[0]?.sql).toContain(
        "dashboard_context_granularity_seconds",
      );
    });
  });

  describe("given the four are laid out on the chart grid", () => {
    /** @scenario "Four cost widgets are laid out on the grid" */
    it("places every widget inside the grid's own bounds", () => {
      for (const widget of GOVERNANCE_WIDGETS) {
        const { graphId, ...placement } = widget.placement;

        expect(graphId).toBeTruthy();
        expect(() => chartGridPlacementSchema.parse(placement)).not.toThrow();
        expect(fitsChartGridWidth(placement)).toBe(true);
      }
    });

    /** @scenario "Four cost widgets are laid out on the grid" */
    it("gives each widget a cell no other widget claims", () => {
      const placements = GOVERNANCE_WIDGETS.map((widget) => widget.placement);

      const collisions = placements.flatMap((a, index) =>
        placements
          .slice(index + 1)
          .filter((b) => overlaps(a, b))
          .map((b) => `${a.graphId} overlaps ${b.graphId}`),
      );

      expect(collisions).toEqual([]);
    });

    /** @scenario "Four cost widgets are laid out on the grid" */
    it("spans the provider and model widgets across the full row", () => {
      expect(widgetById("provider_day")?.placement.colSpan).toBe(
        CHART_GRID_COLUMNS,
      );
      expect(widgetById("model_agent")?.placement.colSpan).toBe(
        CHART_GRID_COLUMNS,
      );
    });

    /** @scenario "Four cost widgets are laid out on the grid" */
    it("sits the department and person widgets side by side on one row", () => {
      const department = widgetById("department")?.placement;
      const person = widgetById("person")?.placement;

      expect(department?.colSpan).toBe(CHART_GRID_COLUMNS / 2);
      expect(person?.colSpan).toBe(CHART_GRID_COLUMNS / 2);
      // Side by side is the same row, not merely two half-width cards.
      expect(department?.gridRow).toBe(person?.gridRow);
    });
  });
});
