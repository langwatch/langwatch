/**
 * The collection probe and the engine tables reach the approved views in a PostgreSQL schema other
 * than public, which the reader role's default search_path ("$user", public) does not include.
 * @see specs/lwql/api.feature
 * @vitest-environment node
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_POSTGRES_READER_LIMITS,
  LangWatchQLPostgresMappingService,
} from "../../features/provisioning/services/langwatch-ql-postgres-mapping.service.ts";
import { LangWatchQLPostgresViewsService } from "../../features/provisioning/services/langwatch-ql-postgres-views.service.ts";
import { LangWatchQLSelfProvisioningService } from "../../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import { ClickHouseLangWatchQLProvisioningRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLCatalogShapesService } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import {
  type LangWatchQLClickHouseHarness,
  type LangWatchQLPostgresHarness,
  lwqlTestNamedCollection,
  mapPostgresIntoClickHouse,
  PG_MAPPED_VIEW,
  selectScalar,
  startLangWatchQLClickHouse,
  startLangWatchQLPostgres,
} from "./lwql-clickhouse-harness.ts";

const ALT_SCHEMA = "lwql_alt";
const postgresViews = LangWatchQLPostgresViewsService.create();
const postgresMapping = LangWatchQLPostgresMappingService.create();
const selfProvisioning = LangWatchQLSelfProvisioningService.create();
const mapped = LangWatchQLCatalogShapesService.create()
  .postgresViews(LWQL_VIEW_CATALOG)
  .find((view) => view.name === PG_MAPPED_VIEW);
if (!mapped) throw new Error(`the shipped catalog has no "${PG_MAPPED_VIEW}" dataset`);
const PARKED_VIEW = `${mapped.postgres.approvedView}_parked`;

describe("given the approved views live in a PostgreSQL schema other than public", () => {
  let harness: LangWatchQLClickHouseHarness;
  let postgres: LangWatchQLPostgresHarness;

  async function asAdmin(statements: string[]): Promise<void> {
    for (const sql of statements) {
      const result = await postgres.asAdmin(sql);
      if (result.exitCode !== 0) throw new Error(`${sql}\n${result.stderr}`);
    }
  }

  beforeAll(async () => {
    postgres = await startLangWatchQLPostgres();
    harness = await startLangWatchQLClickHouse({ suite: "pgaltschema" });
    const relations = [
      mapped.postgres.baseRelation,
      ...(mapped.postgres.tenantPath ?? []).map((hop) => hop.relation),
    ];
    await asAdmin([
      `CREATE SCHEMA ${ALT_SCHEMA}`,
      ...[...new Set(relations)].map(
        (relation) => `CREATE TABLE ${ALT_SCHEMA}."${relation}" AS TABLE public."${relation}"`,
      ),
      ...postgresViews.approvedViewStatements({ schema: ALT_SCHEMA, views: [mapped] }),
      ...postgresMapping.readerRoleStatements({
        reader: {
          role: postgres.readerRole,
          password: postgres.readerPassword,
          schema: ALT_SCHEMA,
          approvedViews: [mapped.postgres.approvedView],
          ...DEFAULT_POSTGRES_READER_LIMITS,
        },
      }),
    ]);
    await mapPostgresIntoClickHouse({ harness, postgres });
    // The harness also provisions the view in public; parked, only the alternate schema holds it,
    // so a probe or engine table that drops the schema fails.
    await asAdmin([
      `ALTER VIEW public."${mapped.postgres.approvedView}" RENAME TO "${PARKED_VIEW}"`,
    ]);
    await harness.applyAsAdmin([
      `DROP TABLE IF EXISTS ${harness.names.database}.${mapped.sourceTable}`,
      ...postgresViews.engineTableStatements({
        names: harness.names,
        collection: lwqlTestNamedCollection(harness.names),
        schema: ALT_SCHEMA,
        views: [mapped],
      }),
    ]);
  }, 240_000);

  afterAll(async () => {
    await postgres?.asAdmin(
      `ALTER VIEW IF EXISTS public."${PARKED_VIEW}" RENAME TO "${mapped.postgres.approvedView}"`,
    );
    await postgres?.asAdmin(`DROP SCHEMA IF EXISTS ${ALT_SCHEMA} CASCADE`);
    await harness?.stop();
    await postgres?.stop();
  });

  describe("when the collection probe and an engine table read through ClickHouse", () => {
    /** @scenario "The collection probe reads the approved view in the app's PostgreSQL schema" */
    it("probes the view by schema and reads rows through the engine table", async () => {
      const repository = ClickHouseLangWatchQLProvisioningRepository.create({
        statements: {
          command: async (query) => void (await harness.admin.command({ query })),
          rows: async (query, params) => {
            const result = await harness.admin.query({
              query,
              format: "JSONEachRow",
              ...(params ? { query_params: { ...params }, use_multipart_params: true } : {}),
            });
            return result.json<Record<string, unknown>>();
          },
          insert: () => Promise.reject(new Error("the probe never inserts")),
        },
      });
      const probe = selfProvisioning.collectionProbe({
        names: harness.names,
        postgres: {
          endpoint: {
            host: "host.docker.internal",
            port: postgres.container.getPort(),
            database: "lwtest",
          },
          readerPassword: postgres.readerPassword,
        },
        schema: ALT_SCHEMA,
      });
      const table = `${harness.names.database}.${mapped.sourceTable}`;

      await repository.probePostgresCollection({
        collection: lwqlTestNamedCollection(harness.names),
        relation: mapped.postgres.approvedView,
        schema: probe.schema,
        cluster: undefined,
      });

      const rows = Number(
        await selectScalar<string>(harness.admin, `SELECT count() AS value FROM ${table}`),
      );
      const ddl = await selectScalar<string>(
        harness.admin,
        `SELECT engine_full AS value FROM system.tables WHERE database = '${harness.names.database}' ` +
          `AND name = '${mapped.sourceTable}'`,
      );
      expect(rows).toBeGreaterThan(0);
      expect(ddl).toContain(`schema = '${ALT_SCHEMA}'`);
    });
  });
});
