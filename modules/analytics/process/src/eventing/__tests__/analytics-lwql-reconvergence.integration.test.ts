/**
 * The reconvergence watch in rendered mode against a real ClickHouse: a converge that fails
 * because the config store has not mounted the named collection yet is retried on the next
 * wake, and that wake creates the PostgreSQL engine tables once the collection appears.
 * @see specs/lwql/api.feature
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LangWatchQLSelfProvisioningService } from "../../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import {
  type LangWatchQLClickHouseHarness,
  startLangWatchQLClickHouse,
} from "../../langwatch-ql/__tests__/lwql-clickhouse-harness.ts";
import { ClickHouseLangWatchQLProvisioningRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts";
import type { LwqlProvisioningDatabase } from "../../repositories/langwatch-ql-postgres.repository.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import type { LangWatchQLNames } from "../../services/langwatch-ql-access-model.service.ts";
import { LangWatchQLCatalogShapesService } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import {
  convergeLwqlAccessModel,
  type LwqlConvergencePlan,
} from "../../tasks/lwql-provision.task.ts";
import { runLwqlReconvergence } from "../analytics-lwql-reconvergence.intent.ts";

const selfProvisioning = LangWatchQLSelfProvisioningService.create();
const ENGINE_TABLES = LangWatchQLCatalogShapesService.create()
  .postgresViews(LWQL_VIEW_CATALOG)
  .map((view) => view.sourceTable);

/** The Postgres half (views, reader role, lock) is not this suite's subject. */
const noPostgres: LwqlProvisioningDatabase = {
  $executeRawUnsafe: async () => 0,
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

/** The plan the worker's rendered-mode converge runs, over the suite's own database. */
function renderedPlan({
  client,
  names,
}: {
  client: ClickHouseClient;
  names: LangWatchQLNames;
}): LwqlConvergencePlan {
  return {
    request: {
      requested: true,
      complete: true,
      connection: {
        url: "http://127.0.0.1:8123",
        username: names.restrictedUser,
        password: "restricted-rendered-secret",
        database: names.database,
        tenantSetting: names.tenantSetting,
      },
      postgresReaderPassword: "reader-rendered-secret",
      endpoint: { host: "host.docker.internal", port: 5432, database: "lwql_rendered" },
    },
    names,
    sourceDatabase: () => names.database,
    schema: "public",
    settings: { LWQL_ACCESS_MODEL_MODE: "rendered" },
    openRepository: () => repositoryOver(client),
  };
}

describe("given a rendered-mode ClickHouse whose config store has not mounted the named collection", () => {
  let harness: LangWatchQLClickHouseHarness;
  let names: LangWatchQLNames;
  let collection: string;

  async function engineTablesPresent(): Promise<string[]> {
    const result = await harness.admin.query({
      query:
        "SELECT name FROM system.tables WHERE database = {database:String} AND engine = 'PostgreSQL'",
      query_params: { database: names.database },
      format: "JSONEachRow",
    });
    return (await result.json<{ name: string }>()).map((row) => row.name);
  }

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({
      suite: "rendered-reconvergence",
      facts: "migrated",
    });
    // Production provisions into the application's own database, which holds the fact tables.
    names = { ...harness.names, database: harness.factDatabase };
    collection = selfProvisioning.namedCollection({ names });
    await harness.applyAsAdmin([`DROP NAMED COLLECTION IF EXISTS ${collection}`]);
  }, 600_000);

  afterAll(async () => {
    await harness?.applyAsAdmin([`DROP NAMED COLLECTION IF EXISTS ${collection}`]);
    await harness?.stop();
  });

  describe("when the watch wakes before and after the collection appears", () => {
    /** @scenario "A rendered install whose named collection appears late converges on a later wake" */
    it("fails without crashing, then creates the PostgreSQL engine tables on the next wake", async () => {
      let converges = 0;
      const wake = runLwqlReconvergence({
        probe: () => Promise.resolve("config_store"),
        converge: () => Promise.resolve(),
        convergeAppOwned: async () => {
          converges += 1;
          await convergeLwqlAccessModel({
            database: noPostgres,
            plan: renderedPlan({ client: harness.admin, names }),
            failOnError: true,
          });
        },
        fillKeyMap: () => Promise.resolve(),
      });

      await expect(wake({ final: false, fillKeyMap: false })).resolves.toBeUndefined();
      expect(await engineTablesPresent()).toEqual([]);

      // The pod re-mounts config.d; the SQL stand-in gives the engine tables the same name.
      await harness.applyAsAdmin([
        `CREATE NAMED COLLECTION ${collection} AS host = 'host.docker.internal', port = 5432, ` +
          `database = 'lwql_rendered', user = 'lwql_ro', password = 'reader-rendered-secret'`,
      ]);

      await expect(wake({ final: false, fillKeyMap: false })).resolves.toBeUndefined();
      expect((await engineTablesPresent()).toSorted()).toEqual(ENGINE_TABLES.toSorted());

      await wake({ final: false, fillKeyMap: false });
      expect(converges).toBe(2);
    });
  });
});
