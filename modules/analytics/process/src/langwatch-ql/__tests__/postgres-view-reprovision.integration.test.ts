/**
 * Re-provisioning over a Postgres view left in an older column order, against a real Postgres:
 * the approved-view and reader statements converge it without error, the columns follow the
 * catalog's order again and the reader role still reads it.
 * @see specs/lwql/postgres-catalog.feature
 * @vitest-environment node
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLCatalogShapesService } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import {
  DEFAULT_POSTGRES_READER_LIMITS,
  LangWatchQLPostgresMappingService,
} from "../../services/langwatch-ql-postgres-mapping.service.ts";
import { LangWatchQLPostgresViewsService } from "../../services/langwatch-ql-postgres-views.service.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("lwql-reprovision-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

const SCHEMA = "public";
const READER_ROLE = `lwql_reader_${randomUUID().slice(0, 8)}`;
const OLD_ORDER_SOURCE = `lwql_old_order_${randomUUID().slice(0, 8)}`;
const postgresViews = LangWatchQLPostgresViewsService.create();
const postgresMapping = LangWatchQLPostgresMappingService.create();
const topics = LangWatchQLCatalogShapesService.create()
  .postgresViews(LWQL_VIEW_CATALOG)
  .find((view) => view.name === "topics");
const APPROVED_VIEW = topics?.postgres.approvedView ?? "";

function client() {
  if (connection === null) throw new Error("DATABASE_URL is required for the re-provision test");
  return connection.client;
}

const run = (statement: string) => client().$executeRawUnsafe(statement);

async function viewColumns(): Promise<string[]> {
  const rows = await client().$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns ` +
      `WHERE table_schema = '${SCHEMA}' AND table_name = '${APPROVED_VIEW}' ORDER BY ordinal_position`,
  );

  return rows.map((row) => row.column_name);
}

const currentStatements = () => [
  ...postgresViews.approvedViewStatements({
    schema: SCHEMA,
    views: topics ? [topics] : [],
    readerRole: READER_ROLE,
  }),
  ...postgresMapping.readerRoleStatements({
    reader: {
      role: READER_ROLE,
      password: "reader-reprovision-secret",
      schema: SCHEMA,
      approvedViews: [APPROVED_VIEW],
      ...DEFAULT_POSTGRES_READER_LIMITS,
      connectionLimit: 2,
    },
  }),
];

async function dropEverything(): Promise<void> {
  await run(`DROP VIEW IF EXISTS "${SCHEMA}"."${APPROVED_VIEW}"`);
  await run(`DROP VIEW IF EXISTS "${SCHEMA}"."${OLD_ORDER_SOURCE}"`);
  await run(`DROP OWNED BY "${READER_ROLE}"`).catch(() => 0);
  await run(`DROP ROLE IF EXISTS "${READER_ROLE}"`);
}

describe.skipIf(!databaseUrl)(
  "Re-provisioning an installation provisioned in an older column order",
  () => {
    let catalogOrder: string[] = [];

    beforeAll(async () => {
      if (!topics) throw new Error("the shipped catalog names no topics view");
      await dropEverything();
      for (const statement of currentStatements()) await run(statement);
      catalogOrder = await viewColumns();
      await run(`ALTER VIEW "${SCHEMA}"."${APPROVED_VIEW}" RENAME TO "${OLD_ORDER_SOURCE}"`);
      const reversed = [...catalogOrder].reverse().map((column) => `"${column}"`);
      await run(
        `CREATE VIEW "${SCHEMA}"."${APPROVED_VIEW}" AS SELECT ${reversed.join(", ")} ` +
          `FROM "${SCHEMA}"."${OLD_ORDER_SOURCE}"`,
      );
    }, 60_000);

    afterAll(async () => {
      try {
        await dropEverything();
      } finally {
        await connection?.closeOnce();
      }
    });

    describe("given a view provisioned in a column order the catalog no longer matches", () => {
      /** @scenario "Re-provisioning an upgraded installation converges the approved views" */
      it("converges without error, in the catalog's order, and the reader role still selects from it", async () => {
        expect(await viewColumns()).toEqual([...catalogOrder].reverse());

        for (const statement of currentStatements()) await run(statement);

        expect(await viewColumns()).toEqual(catalogOrder);
        const readable = await client().$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL ROLE "${READER_ROLE}"`);
          return tx.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT count(*) AS n FROM "${SCHEMA}"."${APPROVED_VIEW}"`,
          );
        });
        expect(Number(readable[0]?.n)).toBeGreaterThanOrEqual(0);
      });
    });
  },
);
