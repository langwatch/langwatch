/**
 * Every stock widget declares its own sources and reads them, and the reviewed change table names
 * each widget whose list differs from what it counted before.
 * @see modules/dashboard/specs/dashboards-v2.feature AC202, AC202b, AC202c, AC202f
 */

import { describe, expect, it } from "vitest";

import {
  namedViews,
  readsSourcesParameter,
  VIEWS_WITH_ORIGIN,
} from "../../model/sources-parameter.ts";
import { IMPLEMENTED_WIDGET_IDS, implementedWidget } from "../index.ts";
import { STOCK_WIDGET_SOURCES } from "../model/stock-widget-sources.ts";
import fixture from "./fixtures/stock-widget-sources.json" with { type: "json" };

const widgets = IMPLEMENTED_WIDGET_IDS.flatMap((id) => implementedWidget(id) ?? []);
const queryKey = (widget: string, query: string) => `${widget}/${query}`;

describe("given the stock widgets of the catalogue", () => {
  /** @scenario "AC202 Stock widgets: every stock query reads the sources parameter, except those on the exemption list" */
  it("has every stock query read the parameter, bar the presence queries and the exempt list", () => {
    const failing = widgets.flatMap(({ key, definition }) =>
      definition.queries
        .filter(({ name }) => name !== "present")
        .filter(({ sql }) => !readsSourcesParameter(sql))
        .map(({ name }) => queryKey(key, name)),
    );

    expect(failing.toSorted()).toEqual([...fixture.exemptQueries].toSorted());
  });

  /** @scenario "AC202 Stock widgets: every stock query reads the sources parameter, except those on the exemption list" */
  it("exempts a query only when every view it reads keeps no origin", () => {
    for (const exempt of fixture.exemptQueries) {
      const [id, name] = exempt.split("/");
      const sql = widgets
        .find(({ key }) => key === id)
        ?.definition.queries.find((query) => query.name === name)?.sql;

      expect(sql, exempt).toBeDefined();
      expect(
        namedViews(sql ?? "").filter((view) => !VIEWS_WITH_ORIGIN.includes(view)).length,
        exempt,
      ).toBeGreaterThan(0);
      expect(readsSourcesParameter(sql ?? ""), exempt).toBe(false);
    }
  });

  /** @scenario "AC202 Stock widgets: every stock query reads the sources parameter, except those on the exemption list" */
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
  it("stores its own non-empty list on every query of every widget", () => {
    for (const { key, definition } of widgets) {
      expect(STOCK_WIDGET_SOURCES[key]?.length, key).toBeGreaterThan(0);
      for (const query of definition.queries) {
        expect(query.sources, `${key}/${query.name}`).toEqual(STOCK_WIDGET_SOURCES[key]);
      }
    }
    expect(Object.keys(STOCK_WIDGET_SOURCES).toSorted()).toEqual(
      widgets.map(({ key }) => key).toSorted(),
    );
  });

  /** @scenario "AC202b Stock widgets: each stock widget declares its own list of sources" */
  it("no longer exports the shared catalogue sources constant", async () => {
    const module = await import("../../templates/model/template-widget.ts");

    expect(module).not.toHaveProperty("CATALOGUE_QUERY_SOURCES");
  });
});

describe("given the reviewed change table", () => {
  const familyOf = (id: string): keyof typeof fixture.families => {
    if (fixture.scenarioWidgets.includes(id)) return "scenario";
    if (fixture.gatewayWidgets.includes(id)) return "gateway";
    if (fixture.codingAgentWidgets.includes(id)) return "codingAgent";
    return "application";
  };

  /** @scenario "AC202c Stock widgets: each widget family declares the list tasks#1025 names, and a change-table row carries any other" */
  it("has each widget declare the list of its family", () => {
    for (const { key } of widgets) {
      expect([...(STOCK_WIDGET_SOURCES[key] ?? [])], key).toEqual(fixture.families[familyOf(key)]);
    }
  });

  /** @scenario "AC202c Stock widgets: each widget family declares the list tasks#1025 names, and a change-table row carries any other" */
  it("has a reasoned row for every widget whose list differs from what it counted before", () => {
    const differing = widgets
      .filter(({ key }) => STOCK_WIDGET_SOURCES[key]?.join() !== fixture.before.join())
      .map(({ key }) => key);

    expect(fixture.changes.map(({ widget }) => widget).toSorted()).toEqual(differing.toSorted());
    for (const row of fixture.changes) {
      const declared = [...(STOCK_WIDGET_SOURCES[row.widget] ?? [])] as string[];
      expect(row.reason.length, row.widget).toBeGreaterThan(0);
      expect(row.removed.toSorted(), row.widget).toEqual(
        fixture.before.filter((source) => !declared.includes(source)).toSorted(),
      );
      expect(row.added.toSorted(), row.widget).toEqual(
        declared.filter((source) => !fixture.before.includes(source)).toSorted(),
      );
    }
  });
});
