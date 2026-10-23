/**
 * Rendered-mode checks on real stores fail safely, then converge once the named collection appears.
 * @see specs/lwql/api.feature
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { LWQL_POSTGRES_READER_ROLE } from "../../features/provisioning/services/langwatch-ql-production-provisioning.service.ts";
import {
  type LwqlAppOwnedDrift,
  LangWatchQLSelfProvisioningService,
} from "../../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import {
  type LangWatchQLClickHouseHarness,
  type LangWatchQLPostgresHarness,
  startLangWatchQLClickHouse,
  startLangWatchQLPostgres,
} from "../../langwatch-ql/__tests__/lwql-clickhouse-harness.ts";
import { ClickHouseLangWatchQLProvisioningRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-provisioning.repository.ts";
import type { LwqlProvisioningDatabase } from "../../repositories/langwatch-ql-postgres.repository.ts";
import { PrismaLangWatchQLPostgresRepository } from "../../repositories/prisma/prisma.langwatch-ql-postgres.repository.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import type { LangWatchQLNames } from "../../services/langwatch-ql-access-model.service.ts";
import { LangWatchQLCatalogShapesService } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import {
  convergeLwqlAccessModel,
  findLwqlAppOwnedDrift,
  type LwqlConvergencePlan,
} from "../../tasks/lwql-provision.task.ts";
import { runLwqlReconvergence } from "../analytics-lwql-reconvergence.intent.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const selfProvisioning = LangWatchQLSelfProvisioningService.create();
const ENGINE_TABLES = LangWatchQLCatalogShapesService.create()
  .postgresViews(LWQL_VIEW_CATALOG)
  .map((view) => view.sourceTable);
const READER_PASSWORD = "reader-reconvergence-secret";
const converged: LwqlAppOwnedDrift = { clickHouse: [], postgres: [], isKeyMapMissing: false };

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

describe("given a rendered install whose config store has not mounted the named collection", () => {
  let harness: LangWatchQLClickHouseHarness;
  let postgres: LangWatchQLPostgresHarness;
  let connection: ReturnType<ReturnType<typeof PrismaConnectionService.create>["connect"]>;
  let names: LangWatchQLNames;
  let collection: string;

  const database = (): LwqlProvisioningDatabase => connection.client;

  /** The plan the worker's rendered-mode converge runs, over the suite's own databases. */
  const plan = (): LwqlConvergencePlan => ({
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
      postgresReaderPassword: READER_PASSWORD,
      endpoint: { host: "unused-in-rendered-mode", port: 5432, database: "unused" },
    },
    names,
    sourceDatabase: () => names.database,
    schema: "public",
    settings: { LWQL_ACCESS_MODEL_MODE: "rendered" },
    openRepository: () => repositoryOver(harness.admin),
  });

  /** A worker that has just started: the check it runs carries nothing from any other. */
  const freshWorkerCheck = (convergeAppOwned = vi.fn(convergeOnly)) => ({
    convergeAppOwned,
    check: runLwqlReconvergence({
      probe: () => Promise.resolve("config_store"),
      converge: () => Promise.resolve(),
      findDrift: () => findLwqlAppOwnedDrift({ database: database(), plan: plan() }),
      convergeAppOwned,
      fillKeyMap: () => Promise.resolve(),
    }),
  });

  function convergeOnly(drift: LwqlAppOwnedDrift): Promise<void> {
    return convergeLwqlAccessModel({
      database: database(),
      plan: plan(),
      failOnError: true,
      only: drift,
    });
  }

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

  beforeAll(async () => {
    [harness, postgres] = await Promise.all([
      startLangWatchQLClickHouse({ suite: "rendered-reconvergence", facts: "migrated" }),
      startLangWatchQLPostgres(),
    ]);
    connection = PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("lwql-reconvergence-test"),
    }).connect(
      PrismaConfigService.create().resolve({
        databaseUrl: postgres.container.getConnectionUri(),
        log: ["error"],
      }),
    );
    // Production provisions into the application's own database, which holds the fact tables.
    names = { ...harness.names, database: harness.factDatabase };
    collection = selfProvisioning.namedCollection({ names, mode: "rendered" });
    // A reused container keeps the facts database, so the app-owned objects go first.
    await harness.applyAsAdmin([
      `DROP NAMED COLLECTION IF EXISTS ${collection}`,
      ...LWQL_VIEW_CATALOG.map((view) => `DROP VIEW IF EXISTS ${names.database}.${view.name}`),
      ...ENGINE_TABLES.map((table) => `DROP TABLE IF EXISTS ${names.database}.${table}`),
    ]);
  }, 600_000);

  afterAll(async () => {
    await harness?.applyAsAdmin([`DROP NAMED COLLECTION IF EXISTS ${collection}`]);
    await connection?.closeOnce();
    await Promise.all([harness?.stop(), postgres?.stop()]);
  });

  describe("when the PostgreSQL catalog is read for the reader's approved views", () => {
    /** @scenario "The reconvergence check skips the PostgreSQL half when the reader role and approved views are in place" */
    it("finds no gap for a role granted every view, and every view ungranted for a role that does not exist", async () => {
      const views = selfProvisioning.approvedPostgresViews();
      const repository = PrismaLangWatchQLPostgresRepository.create(database());

      const granted = await repository.findApprovedViews({
        schema: "public",
        role: postgres.readerRole,
        views,
      });
      expect(selfProvisioning.findPostgresGaps({ found: granted })).toEqual([]);

      const absent = await repository.findApprovedViews({
        schema: "public",
        role: "lwql_role_that_does_not_exist",
        views,
      });
      expect(selfProvisioning.findPostgresGaps({ found: absent })).toEqual(
        views.map((view) => ({ view, absent: false })),
      );
    });
  });

  describe("when checks run before and after the collection appears", () => {
    /** @scenario "A rendered install whose named collection appears late converges on a later check" */
    it("fails without crashing while it is absent, then converges on the next check and then does nothing", async () => {
      // A deploy fails at the engine tables, but its PostgreSQL half and reader role land.
      await convergeLwqlAccessModel({ database: database(), plan: plan() });
      const [dropped, revoked] = selfProvisioning.approvedPostgresViews();
      if (!dropped || !revoked) throw new Error("the catalog maps too few PostgreSQL datasets");
      await database().$executeRawUnsafe(`DROP VIEW public."${dropped}"`);
      await database().$executeRawUnsafe(
        `REVOKE SELECT ON public."${revoked}" FROM ${LWQL_POSTGRES_READER_ROLE}`,
      );

      const before = await findLwqlAppOwnedDrift({ database: database(), plan: plan() });
      expect(before.clickHouse).toEqual(expect.arrayContaining(ENGINE_TABLES));
      expect(before.postgres).toEqual([
        { view: dropped, absent: true },
        { view: revoked, absent: false },
      ]);

      for (let checks = 0; checks < 2; checks++) {
        await expect(freshWorkerCheck().check({ fillKeyMap: false })).resolves.toBeUndefined();
      }
      // The PostgreSQL half converged on the first check even though ClickHouse could not.
      const absent = await findLwqlAppOwnedDrift({ database: database(), plan: plan() });
      expect(absent.postgres).toEqual([]);
      expect(absent.clickHouse).toEqual(expect.arrayContaining(ENGINE_TABLES));

      // The pod re-mounts config.d; the SQL stand-in reads PostgreSQL as the converged reader.
      await harness.applyAsAdmin([
        `CREATE NAMED COLLECTION ${collection} AS host = '${postgres.container.getIpAddress("bridge")}', ` +
          `port = 5432, database = '${postgres.container.getDatabase()}', ` +
          `user = '${LWQL_POSTGRES_READER_ROLE}', password = '${READER_PASSWORD}'`,
      ]);
      await freshWorkerCheck().check({ fillKeyMap: false });

      expect(await findLwqlAppOwnedDrift({ database: database(), plan: plan() })).toEqual(
        converged,
      );
      expect(await answers()).toHaveLength(ENGINE_TABLES.length);

      const later = freshWorkerCheck();
      await later.check({ fillKeyMap: false });
      expect(later.convergeAppOwned).not.toHaveBeenCalled();
    });
  });
});
