/** Real PostgreSQL reconvergence fails for a missing role, then grants after restoration.
 * @see specs/lwql/api.feature
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

import { LangWatchQLProductionProvisioningService } from "../../features/provisioning/services/langwatch-ql-production-provisioning.service.ts";
import { postgresLiteral } from "../../rules/langwatch-ql-sql-literal.rules.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("lwql-reader-reconvergence-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const SCHEMA = `lwql_reader_schema_${suffix}`;
const ROLE = `lwql_reader_role_${suffix}`;
const APPROVED_VIEW = `lwql_reader_view_${suffix}`;
const MISSING_VIEW = `lwql_missing_view_${suffix}`;
const UNRELATED_TABLE = `lwql_unrelated_${suffix}`;
const BASE_TABLE = `lwql_reader_base_${suffix}`;
const sourceView = LWQL_VIEW_CATALOG.find((view) => view.postgres !== void 0);
const testViews = sourceView?.postgres
  ? [
      {
        ...sourceView,
        postgres: { ...sourceView.postgres, approvedView: APPROVED_VIEW },
      },
      {
        ...sourceView,
        postgres: { ...sourceView.postgres, approvedView: MISSING_VIEW },
      },
    ]
  : [];
const provisioning = LangWatchQLProductionProvisioningService.create();

function client() {
  if (connection === null) {
    throw new Error("DATABASE_URL is required for the reader reconvergence test");
  }
  return connection.client;
}

const run = (statement: string) => client().$executeRawUnsafe(statement);

function grantStatement(): string {
  const [statement] = provisioning.postgresReaderGrantStatements({
    schema: SCHEMA,
    role: ROLE,
    views: testViews,
  });
  if (!statement) throw new Error("the production service emitted no reader grant statement");
  return statement;
}

async function hasSelect(relation: string): Promise<boolean> {
  const rows = await client().$queryRawUnsafe<{ granted: boolean }[]>(
    `SELECT has_table_privilege(${postgresLiteral(ROLE)}, ${postgresLiteral(`${SCHEMA}.${relation}`)}, 'SELECT') AS granted`,
  );
  return rows[0]?.granted ?? false;
}

async function roleExists(): Promise<boolean> {
  const rows = await client().$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${postgresLiteral(ROLE)}) AS exists`,
  );
  return rows[0]?.exists ?? false;
}

async function readApprovedViewAsRole(): Promise<number[]> {
  return client().$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE "${ROLE}"`);
    const rows = await tx.$queryRawUnsafe<{ id: number }[]>(
      `SELECT id FROM "${SCHEMA}"."${APPROVED_VIEW}" ORDER BY id`,
    );
    return rows.map((row) => row.id);
  });
}

async function dropEverything(): Promise<void> {
  await run(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await run(`DROP ROLE IF EXISTS "${ROLE}"`);
}

describe.skipIf(!databaseUrl)("PostgreSQL reader-role reconvergence", () => {
  beforeAll(async () => {
    if (testViews.length === 0) throw new Error("the shipped catalog has no PostgreSQL view");
    await dropEverything();
    await run(`CREATE SCHEMA "${SCHEMA}"`);
    await run(`CREATE TABLE "${SCHEMA}"."${BASE_TABLE}" (id integer PRIMARY KEY)`);
    await run(`CREATE TABLE "${SCHEMA}"."${UNRELATED_TABLE}" (id integer PRIMARY KEY)`);
    await run(`INSERT INTO "${SCHEMA}"."${BASE_TABLE}" (id) VALUES (1)`);
    await run(
      `CREATE VIEW "${SCHEMA}"."${APPROVED_VIEW}" AS ` +
        `SELECT id FROM "${SCHEMA}"."${BASE_TABLE}"`,
    );
  });

  afterAll(async () => {
    try {
      await dropEverything();
    } finally {
      await connection?.closeOnce();
    }
  });

  describe("when the reader role disappeared before the check", () => {
    /** @scenario "A missing PostgreSQL reader role makes reconvergence grants fail and preserves unrelated access" */
    it("fails loudly, rolls back a partial grant, then grants every approved view after restoration", async () => {
      await run(`DROP ROLE IF EXISTS "${ROLE}"`);

      await expect(run(grantStatement())).rejects.toMatchObject({
        code: "P2010",
        meta: expect.objectContaining({
          driverAdapterError: expect.objectContaining({
            cause: expect.objectContaining({ originalCode: "42704" }),
          }),
        }),
      });
      expect(await roleExists()).toBe(false);

      await run(`CREATE ROLE "${ROLE}" NOLOGIN`);
      expect(await hasSelect(APPROVED_VIEW)).toBe(false);
      await run(`GRANT SELECT ON "${SCHEMA}"."${UNRELATED_TABLE}" TO "${ROLE}"`);

      await expect(run(grantStatement())).rejects.toMatchObject({
        code: "P2010",
        meta: expect.objectContaining({
          driverAdapterError: expect.objectContaining({
            cause: expect.objectContaining({ originalCode: "42P01" }),
          }),
        }),
      });
      expect(await hasSelect(APPROVED_VIEW)).toBe(false);

      await run(
        `CREATE VIEW "${SCHEMA}"."${MISSING_VIEW}" AS ` +
          `SELECT id FROM "${SCHEMA}"."${BASE_TABLE}"`,
      );
      await expect(run(grantStatement())).resolves.toBeDefined();

      expect(await readApprovedViewAsRole()).toEqual([1]);
      expect(await hasSelect(APPROVED_VIEW)).toBe(true);
      expect(await hasSelect(MISSING_VIEW)).toBe(true);
      expect(await hasSelect(UNRELATED_TABLE)).toBe(true);
    });
  });
});
