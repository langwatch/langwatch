/**
 * Postgres dates read through LangWatchQL as the dates Postgres holds, against a real Postgres
 * and ClickHouse: before langwatch/tasks#958 every one of them read as a date in the year 2299.
 * @see specs/lwql/postgres-catalog.feature
 * @vitest-environment node
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LangWatchQLPostgresViewsService } from "../../features/provisioning/services/langwatch-ql-postgres-views.service.ts";
import { LangWatchQLViewProvisioningService } from "../../features/provisioning/services/langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "../../features/provisioning/services/langwatch-ql-view-statements.service.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLViewDefinition,
} from "../../services/langwatch-ql-catalog-shapes.service.ts";
import {
  type LangWatchQLClickHouseHarness,
  type LangWatchQLPostgresHarness,
  lwqlTestNamedCollection,
  mapPostgresIntoClickHouse,
  selectRows,
  selectScalar,
  startLangWatchQLClickHouse,
  startLangWatchQLPostgres,
} from "./lwql-clickhouse-harness.ts";

const postgresViews = LangWatchQLPostgresViewsService.create();
const viewProvisioning = LangWatchQLViewProvisioningService.create();
const POSTGRES_VIEWS = LangWatchQLCatalogShapesService.create().postgresViews(LWQL_VIEW_CATALOG);

/** A creation date with a millisecond part, before the share date the filter case uses. */
const PROJECT_CREATED_AT = "2026-03-14 09:26:53.589";

/**
 * Where a mis-scaled read saturates: the DateTime64 maximum, 2299-12-31 before ClickHouse 26.x
 * widened the range and 9999-12-31 from then on.
 */
const SATURATED_DATE = /^(2299|9999)-12-31/;

const isScalarDate = (type: string) => type.includes("DateTime64") && !type.startsWith("Array");

/** Rows of a `psql -tA` read, one per line, failing loudly on an error. */
async function postgresLines(read: Promise<{ stdout: string; stderr: string; exitCode: number }>) {
  const result = await read;
  expect(result.exitCode, result.stderr).toBe(0);
  return result.stdout.split("\n").filter((line) => line.length > 0);
}

describe("given every Postgres-backed view mapped into ClickHouse over seeded rows", () => {
  let harness: LangWatchQLClickHouseHarness;
  let postgres: LangWatchQLPostgresHarness;
  let tenantA: ClickHouseClient;
  let database: string;
  let tenantId: string;

  const provisionViews = (views: readonly LangWatchQLViewDefinition[]) =>
    harness.applyAsAdmin(
      viewProvisioning.setupStatements({
        names: harness.names,
        sourceDatabase: harness.factDatabase,
        views,
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    );

  beforeAll(async () => {
    postgres = await startLangWatchQLPostgres();
    // Every seeded date gets a millisecond part, so "to the millisecond" is tested everywhere.
    const dated = await postgresLines(
      postgres.asAdmin(
        `SELECT format('UPDATE public.%I SET %I = %I + interval ''589 milliseconds''', ` +
          `c.table_name, c.column_name, c.column_name) ` +
          `FROM information_schema.columns c JOIN information_schema.tables t ` +
          `ON t.table_schema = c.table_schema AND t.table_name = c.table_name ` +
          `WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' ` +
          `AND c.data_type IN ('timestamp without time zone', 'timestamp with time zone')`,
      ),
    );
    harness = await startLangWatchQLClickHouse({ suite: "pgdates" });
    database = harness.names.database;
    tenantId = harness.tenantA.tenantId;
    await postgresLines(
      postgres.asAdmin(
        [
          ...dated,
          `UPDATE public."Project" SET "createdAt" = '${PROJECT_CREATED_AT}' WHERE "id" = '${tenantId}'`,
        ].join(";\n"),
      ),
    );
    await mapPostgresIntoClickHouse({ harness, postgres });
    await provisionViews(POSTGRES_VIEWS);
    await harness.applyAccessModel({
      extraViews: POSTGRES_VIEWS,
      sourceDatabase: harness.factDatabase,
    });
    tenantA = await harness.restrictedClient({ keyHash: harness.tenantA.keyHash });
  }, 240_000);

  afterAll(async () => {
    await harness?.stop();
    await postgres?.stop();
  });

  describe("when the project reads every date column of every Postgres-backed view", () => {
    /** @scenario "Every date on every Postgres-backed view equals the Postgres value" */
    it("reads each date as Postgres holds it, to the millisecond", async () => {
      let compared = 0;
      for (const view of POSTGRES_VIEWS) {
        for (const column of view.columns.filter((candidate) => isScalarDate(candidate.type))) {
          const fromClickHouse = await selectRows<{ value: string }>(
            tenantA,
            `SELECT toString(${column.name}) AS value FROM ${database}.${view.name} ` +
              `WHERE ${column.name} IS NOT NULL ORDER BY value`,
          );
          const fromPostgres = await postgresLines(
            postgres.asReader(
              `SELECT to_char("${column.name}", 'YYYY-MM-DD HH24:MI:SS.MS') AS value ` +
                `FROM public."${view.postgres.approvedView}" ` +
                `WHERE "TenantId" = '${tenantId}' AND "${column.name}" IS NOT NULL ORDER BY value`,
            ),
          );

          const values = fromClickHouse.map((row) => row.value);
          expect(values, `${view.name}.${column.name}`).toEqual(fromPostgres);
          expect(
            values.some((value) => SATURATED_DATE.test(value)),
            `${view.name}`,
          ).toBe(false);
          compared += values.length;
        }
      }
      expect(
        compared,
        "no seeded date was compared; the assertion above is vacuous",
      ).toBeGreaterThan(0);
    });

    it("keeps millisecond dates on the view", async () => {
      const row = await selectScalar<string>(
        tenantA,
        `SELECT concat(toString(CreatedAt), ' ', toTypeName(CreatedAt)) AS value ` +
          `FROM ${database}.projects`,
      );

      expect(row).toBe(`${PROJECT_CREATED_AT} DateTime64(3)`);
    });
  });

  describe("when a date filter takes its bound from a joined row", () => {
    // A constant bound is pushed down to Postgres, which compares the real date and hid the
    // bug; a bound from a join is compared in ClickHouse, where the year-2299 value leaked.
    const countCreatedFrom = (since: string) =>
      selectScalar<string>(
        tenantA,
        `SELECT toString(count()) AS value FROM ${database}.projects AS p ` +
          `INNER JOIN (SELECT toDateTime64('${since}', 3) AS since) AS bound ON 1 = 1 ` +
          `WHERE p.CreatedAt >= bound.since`,
      );

    /** @scenario "A date filter compares against the real date" */
    it("counts no project created before the bound", async () => {
      expect(await countCreatedFrom("2026-06-01 00:00:00")).toBe("0");
    });

    it("still counts the project from a bound before its creation", async () => {
      expect(await countCreatedFrom("2026-03-01 00:00:00")).toBe("1");
    });
  });

  describe("when provisioning runs over an engine table declared at the old scale", () => {
    /** @scenario "Re-provisioning replaces an engine table declared at the old scale" */
    it("declares DateTime64(6) again and reads the date Postgres holds", async () => {
      const projects = POSTGRES_VIEWS.find((view) => view.name === "projects");
      if (!projects) throw new Error("the catalog no longer carries a projects view");
      const collection = lwqlTestNamedCollection(harness.names);
      const current = postgresViews.engineTableStatements({
        names: harness.names,
        collection,
        views: [projects],
      });
      const engineType = () =>
        selectScalar<string>(
          harness.admin,
          `SELECT type AS value FROM system.columns ` +
            `WHERE database = '${database}' AND table = '${projects.sourceTable}' AND name = 'CreatedAt'`,
        );

      await harness.applyAsAdmin(
        current.map((sql) => sql.replaceAll("DateTime64(6", "DateTime64(3")),
      );
      await provisionViews([projects]);
      expect(await engineType()).toBe("DateTime64(3)");
      const broken = await selectScalar<string>(
        tenantA,
        `SELECT toString(CreatedAt) AS value FROM ${database}.projects`,
      );
      expect(broken, "the old scale did not reproduce the bug").toMatch(SATURATED_DATE);

      await harness.applyAsAdmin(current);
      await provisionViews([projects]);

      expect(await engineType()).toBe("DateTime64(6)");
      expect(
        await selectScalar<string>(
          tenantA,
          `SELECT toString(CreatedAt) AS value FROM ${database}.projects`,
        ),
      ).toBe(PROJECT_CREATED_AT);
    });
  });
});
