/**
 * Eventing's event tables reach LangWatchQL only through its declarations (Q205); the fixture is
 * the five views as published before analytics composed them.
 */

import { EVENT_TABLE_DECLARATIONS } from "@langwatch/eventing/server";
import { describe, expect, it } from "vitest";

import { exposedCatalogueColumns } from "../lwql-catalogue.rules.ts";
import { LWQL_CATALOG, LWQL_VIEW_CATALOG } from "../lwql-view-catalog.rules.ts";
import beforeJson from "./fixtures/lwql-event-table-views-before.json" with { type: "json" };

const before: Readonly<Record<string, unknown>> = beforeJson;
const catalogue: Readonly<Record<string, (typeof LWQL_CATALOG)[keyof typeof LWQL_CATALOG]>> =
  LWQL_CATALOG;
const tableOf = (view: string) => {
  const table = catalogue[view];
  if (table === undefined) throw new Error(`no catalogue table for ${view}`);
  return table;
};

describe("given eventing's event-table declarations", () => {
  describe("when analytics composes its LangWatchQL catalogue", () => {
    /** @scenario "Each declared event table is catalogued under its declared view name" */
    it("catalogues every declared view over its declared source table", () => {
      for (const { view, sourceTable } of EVENT_TABLE_DECLARATIONS) {
        expect({ view, sourceTable: tableOf(view).sourceTable }).toEqual({ view, sourceTable });
        expect(LWQL_VIEW_CATALOG.map(({ name }) => name)).toContain(view);
      }
    });

    /** @scenario "An event-table view needs project management on top of analytics access" */
    it("requires analytics:view and project:manage on every event-table view", () => {
      for (const { view } of EVENT_TABLE_DECLARATIONS) {
        expect(tableOf(view).access).toEqual({ allOf: ["analytics:view", "project:manage"] });
      }
    });

    /** @scenario "A column eventing marks as secret or internal is exposed nowhere" */
    it("omits every column declared secret or internal", () => {
      for (const { view, columns } of EVENT_TABLE_DECLARATIONS) {
        const exposed = exposedCatalogueColumns({ table: tableOf(view) }).map(({ name }) => name);
        for (const [name, column] of Object.entries(columns)) {
          if (!("omitted" in column)) continue;
          expect(tableOf(view).columns[name]).toBe("omit");
          expect(exposed).not.toContain(name);
        }
      }
    });

    /** @scenario "A column eventing marks as captured output is gated by the data-privacy policy" */
    it("gates every column declared as captured output", () => {
      for (const { view, columns } of EVENT_TABLE_DECLARATIONS) {
        const exposed = exposedCatalogueColumns({ table: tableOf(view) });
        for (const [name, column] of Object.entries(columns)) {
          if (!("content" in column)) continue;
          expect(exposed.find((entry) => entry.name === name)?.content).toBe("output");
        }
      }
    });
  });

  describe("when the composed views are published", () => {
    /** @scenario "The event-table views publish the same definitions as before the move" */
    it("publishes each event-table view as it was before the move", () => {
      const published = LWQL_VIEW_CATALOG.filter(({ name }) => name in before);
      expect(
        JSON.parse(JSON.stringify(Object.fromEntries(published.map((v) => [v.name, v])))),
      ).toEqual(before);
    });

    /** @scenario "The event-table views publish the same definitions as before the move" */
    it("keeps each event-table view in its place in the published order", () => {
      const names = LWQL_VIEW_CATALOG.map(({ name }) => name);
      const neighbours = (view: string) =>
        names.slice(names.indexOf(view) - 1, names.indexOf(view) + 2);
      expect(neighbours("legacy_event_log")).toEqual([
        "langy_usage_events",
        "legacy_event_log",
        "legacy_log_records",
      ]);
      expect(neighbours("process_manager_inboxes")[0]).toBe("pinned_traces");
      expect(neighbours("process_manager_outboxes")[2]).toBe("projects");
    });
  });
});
