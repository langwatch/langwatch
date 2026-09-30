/** The database backstop grants only what the catalogue exposes (ADR-082, ADR-159). */
import { describe, expect, it } from "vitest";

import { exposedCatalogueColumns, type LwqlCatalogue } from "../../rules/lwql-catalogue.rules.ts";
import { LWQL_CATALOG, LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLAccessModelDefinitionService } from "../langwatch-ql-access-model-definition.service.ts";
import { LangWatchQLCatalogShapesService } from "../langwatch-ql-catalog-shapes.service.ts";

const shapes = LangWatchQLCatalogShapesService.create();
const catalog: LwqlCatalogue = LWQL_CATALOG;
const definition = LangWatchQLAccessModelDefinitionService.create().build({
  names: {
    database: "langwatch",
    restrictedUser: "langwatch_lwql",
    settingsProfile: "langwatch_profile",
    keyMapTable: "lwql_api_key_tenant_map",
    tenantSetting: "custom_api_key_hash",
  },
  passwordSha256Hex: "a".repeat(64),
  namedCollection: {
    collection: "lwql_postgres",
    host: "pg.internal",
    port: 5432,
    database: "langwatch",
    user: "lwql_ro",
    password: "pg-reader-secret",
  },
  sourceDatabase: "langwatch",
});

/** A column a view reads only to dedup, filter or join, which the catalogue need not expose. */
function structuralColumns(view: (typeof LWQL_VIEW_CATALOG)[number]): ReadonlySet<string> {
  return new Set([
    ...view.dedup.keyColumns.map((key) => shapes.physicalColumn(view, key)),
    ...(view.dedup.versionColumn ? [view.dedup.versionColumn] : []),
    ...(view.whereSourceColumns ?? []),
    ...(view.join?.onSourceColumns?.primary ?? []),
    ...(view.tenantColumn ? [view.tenantColumn] : ["TenantId"]),
  ]);
}

describe("the access model's grants", () => {
  /** @scenario "The database grants are derived from the same catalogue" */
  it("grants each view's source only the columns its catalogue table exposes", () => {
    const sourceGrants = definition.grants.slice(1, 1 + LWQL_VIEW_CATALOG.length);

    LWQL_VIEW_CATALOG.forEach((view, index) => {
      const table = catalog[view.name];
      expect(table, `${view.name} has a catalogue table`).toBeDefined();
      if (table === undefined || shapes.isPostgresResident(view)) return;

      const exposed = new Set(exposedCatalogueColumns({ table }).map((column) => column.source));
      const structural = structuralColumns(view);
      const granted = sourceGrants[index]?.columns ?? [];
      const unexposed = granted.filter((column) => !exposed.has(column) && !structural.has(column));

      expect(unexposed, `${view.name} grants columns its catalogue does not expose`).toEqual([]);
    });
  });

  it("grants a view name only where the catalogue declares that table", () => {
    const viewGrants = definition.grants
      .slice(-LWQL_VIEW_CATALOG.length)
      .map((grant) => grant.table);

    expect(viewGrants.filter((name) => catalog[name] === undefined)).toEqual([]);
  });
});
