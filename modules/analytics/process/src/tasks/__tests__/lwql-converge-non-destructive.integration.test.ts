/**
 * A converge that fails on a real ClickHouse keeps the working PostgreSQL engine tables (#8726).
 * @see specs/lwql/api.feature
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LWQL_POSTGRES_READER_ROLE } from "../../features/provisioning/services/langwatch-ql-production-provisioning.service.ts";
import { LangWatchQLSelfProvisioningService } from "../../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import {
  type LangWatchQLClickHouseHarness,
  type LangWatchQLPostgresHarness,
  startLangWatchQLClickHouse,
  startLangWatchQLPostgres,
} from "../../langwatch-ql/__tests__/lwql-clickhouse-harness.ts";
import { ClickHouseLangWatchQLProvisioningRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts";
import type { LwqlProvisioningDatabase } from "../../repositories/langwatch-ql-postgres.repository.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import type { LangWatchQLNames } from "../../services/langwatch-ql-access-model.service.ts";
import { LangWatchQLCatalogShapesService } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import { convergeLwqlAccessModel, type LwqlConvergencePlan } from "../lwql-provision.task.ts";

const selfProvisioning = LangWatchQLSelfProvisioningService.create();
const POSTGRES_VIEWS = LangWatchQLCatalogShapesService.create().postgresViews(LWQL_VIEW_CATALOG);
const ENGINE_TABLES = [...new Set(POSTGRES_VIEWS.map((view) => view.sourceTable))];

/** The PostgreSQL half runs against the harness's own server in its own suite. */
const noPostgres: LwqlProvisioningDatabase = {
  $executeRawUnsafe: async () => 0,
  $queryRawUnsafe: async () => [],
  $transaction: (fn) => fn({ $executeRawUnsafe: async () => 0 }),
};

function repositoryOver(client: ClickHouseClient) {
  return ClickHouseLangWatchQLProvisioningRepository.create({
    statements: {
      async command(statement) {
        await client.command({ query: statement });
      },
      async rows(sql, params) {
        const result = await client.query({
          query: sql,
          format: "JSONEachRow",
          ...(params ? { query_params: { ...params } } : {}),
        });
        return result.json<Record<string, unknown>>();
      },
      async insert({ table, rows }) {
        await client.insert({ table, values: [...rows], format: "JSONEachRow" });
      },
    },
  });
}

describe("given a rendered-mode install whose PostgreSQL engine tables work", () => {
  let harness: LangWatchQLClickHouseHarness;
  let postgres: LangWatchQLPostgresHarness;
  let names: LangWatchQLNames;
  let collection: string;

  const plan = (): LwqlConvergencePlan => ({
    request: {
      requested: true,
      complete: true,
      connection: {
        url: "http://127.0.0.1:8123",
        username: names.restrictedUser,
        password: "restricted-non-destructive-secret",
        database: names.database,
        tenantSetting: names.tenantSetting,
      },
      postgresReaderPassword: postgres.readerPassword,
      // What the config store renders, so the check can show ClickHouse holds the app's values.
      endpoint: {
        host: postgres.container.getIpAddress("bridge"),
        port: 5432,
        database: postgres.container.getDatabase(),
      },
    },
    names,
    sourceDatabase: () => names.database,
    schema: "public",
    settings: { LWQL_ACCESS_MODEL_MODE: "rendered" },
    openRepository: () => repositoryOver(harness.admin),
  });

  async function engineTables(): Promise<string[]> {
    const result = await harness.admin.query({
      query:
        "SELECT name FROM system.tables WHERE database = {database:String} AND engine = 'PostgreSQL' ORDER BY name",
      query_params: { database: names.database },
      format: "JSONEachRow",
    });
    return (await result.json<{ name: string }>()).map((row) => row.name);
  }

  /** Each engine table read through to PostgreSQL; a dropped one throws UNKNOWN_TABLE. */
  async function answers(): Promise<number[]> {
    return Promise.all(
      ENGINE_TABLES.map(async (table) => {
        const result = await harness.admin.query({
          query: `SELECT count() AS n FROM ${names.database}.${table}`,
          format: "JSONEachRow",
        });
        const [row] = await result.json<{ n: string }>();
        return Number(row?.n);
      }),
    );
  }

  /** Each LangWatchQL view over an engine table, read through to PostgreSQL. */
  async function viewAnswers(): Promise<number[]> {
    return Promise.all(
      POSTGRES_VIEWS.map(async (view) => {
        const result = await harness.admin.query({
          query: `SELECT count() AS n FROM ${names.database}.${view.name}`,
          format: "JSONEachRow",
        });
        const [row] = await result.json<{ n: string }>();
        return Number(row?.n);
      }),
    );
  }

  beforeAll(async () => {
    [harness, postgres] = await Promise.all([
      startLangWatchQLClickHouse({ suite: "converge-non-destructive", facts: "migrated" }),
      startLangWatchQLPostgres(),
    ]);
    names = { ...harness.names, database: harness.factDatabase };
    collection = selfProvisioning.namedCollection({ names });
    // The app's own reader role, which the deploy's PostgreSQL half converges in production.
    for (const statement of selfProvisioning.postgresReaderStatements({
      readerPassword: postgres.readerPassword,
      schema: "public",
    })) {
      const result = await postgres.asAdmin(statement);
      if (result.exitCode !== 0) throw new Error(`reader role setup failed: ${result.stderr}`);
    }
    // The SQL stand-in for the collection the config store mounts; the containers share a bridge.
    await harness.applyAsAdmin([
      `DROP NAMED COLLECTION IF EXISTS ${collection}`,
      `CREATE NAMED COLLECTION ${collection} AS host = '${postgres.container.getIpAddress("bridge")}', ` +
        `port = 5432, database = '${postgres.container.getDatabase()}', ` +
        `user = '${LWQL_POSTGRES_READER_ROLE}', password = '${postgres.readerPassword}'`,
    ]);
    await convergeLwqlAccessModel({ database: noPostgres, plan: plan(), failOnError: true });
  }, 600_000);

  afterAll(async () => {
    // A reused container reloads each table at restart; one whose collection is gone never loads.
    await harness?.applyAsAdmin([
      ...ENGINE_TABLES.map((table) => `DROP TABLE IF EXISTS ${names.database}.${table}`),
      `DROP NAMED COLLECTION IF EXISTS ${collection}`,
    ]);
    await Promise.all([harness?.stop(), postgres?.stop()]);
  });

  describe("when converges run again over the views and engine tables already present", () => {
    /** @scenario "A converge over present views and engine tables succeeds again and the views still answer" */
    it("succeeds each time, replacing an engine table under its views, and every view still answers", async () => {
      const [engineTable] = ENGINE_TABLES;
      if (!engineTable) throw new Error("the catalog maps no PostgreSQL dataset");

      await expect(
        convergeLwqlAccessModel({ database: noPostgres, plan: plan(), failOnError: true }),
      ).resolves.toBeUndefined();
      await expect(
        convergeLwqlAccessModel({
          database: noPostgres,
          plan: plan(),
          failOnError: true,
          only: { clickHouse: [engineTable], postgres: [], isKeyMapMissing: false },
        }),
      ).resolves.toBeUndefined();

      expect(await engineTables()).toEqual(ENGINE_TABLES.toSorted());
      const answered = await viewAnswers();
      expect(answered).toHaveLength(POSTGRES_VIEWS.length);
      expect(answered.every((count) => Number.isInteger(count))).toBe(true);
    });
  });

  describe("when the named collection disappears and a converge runs", () => {
    /** @scenario "A failed converge never removes a working engine table" */
    it("fails, and every engine table still exists and still answers", async () => {
      expect(await engineTables()).toEqual(ENGINE_TABLES.toSorted());
      const before = await answers();

      await harness.applyAsAdmin([`DROP NAMED COLLECTION ${collection}`]);
      await expect(
        convergeLwqlAccessModel({ database: noPostgres, plan: plan(), failOnError: true }),
      ).rejects.toMatchObject({ code: "669" });

      expect(await engineTables()).toEqual(ENGINE_TABLES.toSorted());
      expect(await answers()).toEqual(before);
    });
  });
});
