/**
 * The Postgres catalogue exposes what the derivation it replaced exposed: the same views, names,
 * sources and gates, less the columns omitted for safety. The fixture is that derivation's output.
 */

import { describe, expect, it } from "vitest";

import { exposedCatalogueColumns, type LwqlTableCatalogue } from "../lwql-catalogue.rules.ts";
import {
  LWQL_POSTGRES_CATALOG,
  LWQL_POSTGRES_CATALOGUE,
} from "../lwql-postgres-view-catalog.rules.ts";
import beforeJson from "./fixtures/lwql-postgres-exposure-before.json" with { type: "json" };

/** Columns the derivation exposed and the catalogue omits, by view and source column. */
const SAFETY_OMISSIONS: Readonly<Record<string, readonly string[]>> = {
  agents: ["config"], // HTTP agent config carries bearer tokens and passwords
  triggers: ["actionParams"], // Slack webhook URLs and recipient emails
  anomaly_rules: ["destinationConfig"], // auth headers, routing keys and emails
  github_installations: ["accountLogin"], // a user account's GitHub handle
};

type Exposure = readonly (string | readonly string[] | undefined)[];
const before: Readonly<Record<string, readonly Exposure[]>> = beforeJson;
const tables: Readonly<Record<string, LwqlTableCatalogue>> = LWQL_POSTGRES_CATALOGUE;

const exposure = (view: (typeof LWQL_POSTGRES_CATALOG)[number]) =>
  view.columns.map((column) => [column.name, column.sourceColumns[0], column.gates]);

describe("given the Postgres catalogue beside the derivation it replaced", () => {
  it("names the same views in the same order", () => {
    expect(LWQL_POSTGRES_CATALOG.map((view) => view.name)).toEqual(Object.keys(before));
  });

  it("exposes each view's names, sources and gates as before, less the safety omissions", () => {
    for (const view of LWQL_POSTGRES_CATALOG) {
      const omitted = SAFETY_OMISSIONS[view.name] ?? [];
      const expected = (before[view.name] ?? []).filter(
        ([, source]) => !omitted.includes(String(source)),
      );
      expect({ view: view.name, columns: exposure(view) }).toEqual({
        view: view.name,
        columns: expected,
      });
    }
  });

  it("lists only omissions the derivation really exposed", () => {
    for (const [name, sources] of Object.entries(SAFETY_OMISSIONS)) {
      const previous = (before[name] ?? []).map(([, source]) => source);
      expect({ name, sources: sources.filter((source) => previous.includes(source)) }).toEqual({
        name,
        sources,
      });
    }
  });

  it("asks analytics:view and a domain permission of every table but the dashboards'", () => {
    const analyticsOnly = ["analytics", "custom_graphs", "dashboards"];
    for (const [name, table] of Object.entries(tables)) {
      const permissions = "allOf" in table.access ? table.access.allOf : [];
      expect({ name, first: permissions[0] }).toEqual({ name, first: "analytics:view" });
      expect({ name, domain: permissions.length > 1 }).toEqual({
        name,
        domain: !analyticsOnly.includes(name),
      });
    }
  });

  it("renders every exposed catalogue column and no omitted one", () => {
    for (const view of LWQL_POSTGRES_CATALOG) {
      const table = tables[view.name]!;
      const declared = exposedCatalogueColumns({ table }).map((column) => column.name);
      expect(view.columns.map((column) => column.name)).toEqual(declared);
    }
  });
});
