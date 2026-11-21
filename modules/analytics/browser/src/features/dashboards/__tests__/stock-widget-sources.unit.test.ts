/**
 * Every stock query that can follow sources reads them, and stores the list its widget counts; a
 * query that reads only views with no origin stores none and its card says sources do not apply.
 * @see modules/dashboard/specs/dashboards-v2.feature AC202, AC202b, AC202c, AC202f
 */

import * as catalogue from "@langwatch/analytics-catalogue";
import {
  IMPLEMENTED_WIDGET_IDS,
  implementedWidget,
  namedViews,
  PRESENCE_QUERY,
  readsSourcesParameter,
  VIEWS_WITH_ORIGIN,
} from "@langwatch/analytics-catalogue";
import { DEFAULT_WIDGET_SOURCES, TRACE_SOURCES } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { SOURCES_DO_NOT_APPLY_LINE, widgetSourcesLine } from "../model/widget-sources.ts";

const widgets = IMPLEMENTED_WIDGET_IDS.flatMap((id) => implementedWidget(id) ?? []);
const queries = widgets.flatMap(({ key, definition }) =>
  definition.queries
    .filter(({ name }) => name !== PRESENCE_QUERY)
    .map((query) => ({ key, ...query })),
);
const PRODUCTION = ["application", "gateway"];

/** The reviewed change table: the widgets whose list is not the default, and why. */
const NON_DEFAULT: Readonly<Record<string, readonly string[]>> = {
  // Slices spend by where it came from, so it counts every source (it counted all before).
  "cost-by-source": TRACE_SOURCES,
  // The three widgets that kept `Origin IN ('', 'application', 'gateway')` in their SQL.
  "cost-waste": PRODUCTION,
  "voice-cost-per-call": PRODUCTION,
  "ext-cost-per-doc": PRODUCTION,
};

describe("given the stock widgets of the catalogue", () => {
  /** @scenario "AC202 Stock widgets: every stock query that names an origin-bearing view reads the sources parameter" */
  it("has every stock query read the parameter unless it reads only views with no origin", () => {
    const unread = queries.filter(({ sql }) => !readsSourcesParameter(sql));

    for (const { key, name, sql } of unread) {
      const views = namedViews(sql);
      expect(
        views.filter((view) => VIEWS_WITH_ORIGIN.includes(view)),
        `${key}/${name} reads ${views.join(", ")}`,
      ).toEqual([]);
    }
    expect(unread.length).toBeGreaterThan(0);
  });

  /** @scenario "AC202 Stock widgets: every stock query that names an origin-bearing view reads the sources parameter" */
  it("does not count a placeholder that is only in a comment or a literal", () => {
    expect(readsSourcesParameter("SELECT 1 /* {dashboard_context_sources:Array(String)} */")).toBe(
      false,
    );
    expect(readsSourcesParameter("SELECT '{dashboard_context_sources:Array(String)}'")).toBe(false);
    expect(
      readsSourcesParameter("SELECT 1 WHERE Source IN {dashboard_context_sources:Array(String)}"),
    ).toBe(true);
  });

  /** @scenario "AC202b Stock widgets: each stock widget declares its own list of sources" */
  it("stores its widget's list on a query that reads sources, and none on one that does not", () => {
    for (const { key, name, sql, sources } of queries) {
      const expected = readsSourcesParameter(sql)
        ? (NON_DEFAULT[key] ?? DEFAULT_WIDGET_SOURCES)
        : undefined;

      expect(sources, `${key}/${name}`).toEqual(expected === undefined ? undefined : [...expected]);
    }
  });

  /** @scenario "AC202c Stock widgets: each widget family declares the list tasks#1025 names, and a change-table row carries any other" */
  it("has each widget off the default named in the change table, and every other on application", () => {
    const stored = widgets.flatMap(({ key, definition }) =>
      definition.queries.flatMap(({ sources }) =>
        sources === undefined ? [] : [{ key, sources }],
      ),
    );

    for (const { key, sources } of stored) {
      expect(sources, key).toEqual([...(NON_DEFAULT[key] ?? ["application"])]);
    }
    expect(new Set(stored.map(({ key }) => key))).toEqual(new Set(stored.map(({ key }) => key)));
    for (const key of Object.keys(NON_DEFAULT)) {
      expect(
        stored.some((entry) => entry.key === key),
        key,
      ).toBe(true);
    }
  });

  /** @scenario "AC202f Stock widgets: a widget that reads a view with no origin says that sources do not apply" */
  it("says sources do not apply on a widget none of whose queries reads them", () => {
    const none = widgets.filter(({ definition }) =>
      definition.queries.every(
        ({ name, sql }) => name === PRESENCE_QUERY || !readsSourcesParameter(sql),
      ),
    );

    expect(none.length).toBeGreaterThan(0);
    for (const { key, definition } of none) {
      expect(widgetSourcesLine(definition.queries), key).toBe(SOURCES_DO_NOT_APPLY_LINE);
    }
  });

  /** @scenario "AC202b Stock widgets: each stock widget declares its own list of sources" */
  it("no longer exports the shared catalogue sources constant", () => {
    expect(catalogue).not.toHaveProperty("CATALOGUE_QUERY_SOURCES");
  });
});
