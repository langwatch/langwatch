/**
 * The PostgreSQL-engine tables declare every date at the scale Postgres stores it, and the
 * LangWatchQL views over them cast it back to the catalogue type (langwatch/tasks#958).
 * @see ../../../../langwatch-ql/__tests__/postgres-engine-datetime.integration.test.ts
 * @see specs/lwql/postgres-catalog.feature
 */
import { describe, expect, it } from "vitest";

import { LWQL_VIEW_CATALOG } from "../../../../rules/lwql-view-catalog.rules.ts";
import type { LangWatchQLNames } from "../../../../services/langwatch-ql-access-model.service.ts";
import { LangWatchQLCatalogShapesService } from "../../../../services/langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLPostgresViewsService } from "../../services/langwatch-ql-postgres-views.service.ts";
import {
  LangWatchQLViewStatementsService,
  SHIPPED_LWQL_DEDUP,
} from "../../services/langwatch-ql-view-statements.service.ts";
import { postgresEngineColumnType } from "../lwql-postgres-engine-type.rules.ts";

const NAMES: LangWatchQLNames = {
  database: "langwatch",
  restrictedUser: "langwatch_lwql",
  settingsProfile: "lwql_restricted",
  keyMapTable: "lwql_api_key_tenant_map",
  tenantSetting: "custom_api_key_hash",
};

const POSTGRES_VIEWS = LangWatchQLCatalogShapesService.create().postgresViews(LWQL_VIEW_CATALOG);
const postgresViews = LangWatchQLPostgresViewsService.create();
const viewStatements = LangWatchQLViewStatementsService.create();

const isDate = (type: string) => type.includes("DateTime64");

/** The `<name> <type>` pairs of one `CREATE OR REPLACE TABLE ... (<columns>) ENGINE` statement. */
function engineColumns(statement: string): Map<string, string> {
  const list = /\((.*)\) ENGINE = PostgreSQL/.exec(statement)?.[1] ?? "";
  const columns = new Map<string, string>();
  for (const pair of list.split(/, (?=[A-Za-z_][A-Za-z0-9_]* )/)) {
    const [name = "", ...type] = pair.split(" ");
    columns.set(name, type.join(" "));
  }
  return columns;
}

describe("postgresEngineColumnType", () => {
  describe("given a catalogue date type", () => {
    it.each([
      ["DateTime64(3)", "DateTime64(6)"],
      ["Nullable(DateTime64(3))", "Nullable(DateTime64(6))"],
      ["Array(DateTime64(3))", "Array(DateTime64(6))"],
      ["DateTime64(3, 'UTC')", "DateTime64(6, 'UTC')"],
    ])("declares %s as %s on the engine table", (catalogueType, engineType) => {
      expect(postgresEngineColumnType(catalogueType)).toBe(engineType);
    });
  });

  describe("given any other catalogue type", () => {
    it.each(["String", "Nullable(String)", "Int32", "Bool", "Decimal(18, 6)", "Array(String)"])(
      "keeps %s unchanged",
      (catalogueType) => {
        expect(postgresEngineColumnType(catalogueType)).toBe(catalogueType);
      },
    );
  });
});

describe("given the shipped Postgres-backed views", () => {
  const dateColumns = POSTGRES_VIEWS.flatMap((view) =>
    view.columns.filter((column) => isDate(column.type)).map((column) => ({ view, column })),
  );

  it("includes date columns, so the assertions below are not vacuous", () => {
    expect(dateColumns.length).toBeGreaterThan(0);
  });

  describe("when their PostgreSQL-engine table statements are built", () => {
    const statements = postgresViews.engineTableStatements({ names: NAMES, collection: "pg" });
    const byTable = new Map(
      POSTGRES_VIEWS.map((view, index) => [
        view.sourceTable,
        engineColumns(statements[index] ?? ""),
      ]),
    );

    /** @scenario "The engine table reads a date at the scale Postgres stores it" */
    it("declares every date column DateTime64(6) and never DateTime64(3)", () => {
      for (const { view, column } of dateColumns) {
        const declared = byTable.get(view.sourceTable)?.get(column.name);
        expect(declared, `${view.sourceTable}.${column.name}`).toContain("DateTime64(6)");
      }
      expect(statements.join("\n")).not.toContain("DateTime64(3)");
    });

    it("keeps every other column at its catalogue type", () => {
      for (const view of POSTGRES_VIEWS) {
        for (const column of view.columns.filter((candidate) => !isDate(candidate.type))) {
          expect(byTable.get(view.sourceTable)?.get(column.name), column.name).toBe(column.type);
        }
      }
    });
  });

  describe("when their LangWatchQL view statements are built", () => {
    const sqlOf = (view: (typeof POSTGRES_VIEWS)[number]) =>
      viewStatements.viewStatement({
        names: NAMES,
        sourceDatabase: NAMES.database,
        view,
        dedup: SHIPPED_LWQL_DEDUP,
      });

    /** @scenario "The view still shows millisecond dates" */
    it("casts every date column back to its catalogue type", () => {
      for (const { view, column } of dateColumns) {
        expect(sqlOf(view)).toContain(
          `CAST(src.\`${column.name}\` AS ${column.type}) AS \`${column.name}\``,
        );
      }
    });

    it("projects every other column unchanged", () => {
      for (const view of POSTGRES_VIEWS) {
        for (const column of view.columns.filter((candidate) => !isDate(candidate.type))) {
          expect(sqlOf(view)).toContain(`  src.\`${column.name}\` AS \`${column.name}\``);
        }
      }
    });
  });

  describe("when a view without a CreatedAt column picks its time column", () => {
    const fallbacks = POSTGRES_VIEWS.filter(
      (view) => view.timeColumn && !view.columns.some((column) => column.name === "CreatedAt"),
    );

    it("still finds it by its DateTime64 catalogue type", () => {
      expect(fallbacks.length).toBeGreaterThan(0);
      for (const view of fallbacks) {
        const timeColumn = view.columns.find((column) => column.name === view.timeColumn);
        expect(timeColumn && isDate(timeColumn.type), `${view.name}.${view.timeColumn}`).toBe(true);
      }
    });
  });
});
