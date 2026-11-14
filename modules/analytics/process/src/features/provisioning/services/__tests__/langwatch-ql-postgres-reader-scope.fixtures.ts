/**
 * Shared seeding and query helpers for the reader-scope integration suites. Each suite starts
 * its own container through {@link startScopeHarness}, so no suite depends on another's state.
 */
import { createHash } from "node:crypto";

import {
  type LangWatchQLPostgresHarness,
  startLangWatchQLPostgres,
  TENANT_A,
  TENANT_B,
} from "../../../../langwatch-ql/__tests__/lwql-clickhouse-harness.ts";
import { LWQL_VIEW_CATALOG } from "../../../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLCatalogShapesService } from "../../../../services/langwatch-ql-catalog-shapes.service.ts";
import {
  LWQL_SCOPED_READER_GROUP,
  LWQL_SHARED_READER_ROLE,
} from "../langwatch-ql-postgres-mapping.service.ts";
import { LangWatchQLPostgresViewsService } from "../langwatch-ql-postgres-views.service.ts";
import { LangWatchQLProductionProvisioningService } from "../langwatch-ql-production-provisioning.service.ts";

export const provisioning = LangWatchQLProductionProvisioningService.create();

export const SCHEMA = "public";
export const SHARED_READER = LWQL_SHARED_READER_ROLE;
export const GROUP = LWQL_SCOPED_READER_GROUP;
const DATABASE = "lwtest";
const ADMIN = "test";
const PASSWORD = "scope-test-pw";

export const ORG_A = `${TENANT_A.tenantId}-org`;
export const ORG_B = `${TENANT_B.tenantId}-org`;
export const PROJECT_A = TENANT_A.tenantId;
export const PROJECT_B = TENANT_B.tenantId;

export const VIEWS = LangWatchQLCatalogShapesService.create().postgresViews(LWQL_VIEW_CATALOG);
export const VIEW_NAMES = LangWatchQLPostgresViewsService.create().approvedViewNames();

export type Row = Record<string, unknown> & { TenantId: string };
export type RowsByView = Record<string, Row[]>;

export const q = (name: string): string => `"${name.replaceAll('"', '""')}"`;

const orgRole = (organizationId: string): string =>
  `lwql_org_${createHash("md5").update(organizationId).digest("hex")}`;

export const canon = (rows: Row[]): string[] => rows.map((row) => JSON.stringify(row)).toSorted();
export const tenantsOf = (rows: Row[]): string[] => rows.map((row) => row.TenantId).toSorted();
export const ownedBy =
  (organizations: Record<string, string>, organizationId: string) => (row: Row) =>
    organizations[row.TenantId] === organizationId;

/** One isolated container, seeded and provisioned, with the queries the suites share. */
export interface ScopeHarness {
  /** Runs SQL as the superuser, or as another login over its own connection. */
  runAs: (args: { user: string; sql: string }) => Promise<string>;
  admin: (sql: string) => Promise<string>;
  applyAll: (statements: string[]) => Promise<void>;
  /** The app's own statements: the views, then the shared reader's grants. */
  provisionViews: () => Promise<void>;
  /** Every view's full rows, as one login sees them, in one round trip. */
  readAllViews: (user: string) => Promise<RowsByView>;
  /** TenantIds the pre-change views expose, derived from base tables and the catalogue paths. */
  baselineTenantIds: () => Promise<Record<string, string[]>>;
  projectOrganizations: () => Promise<Record<string, string>>;
  stop: () => Promise<void>;
}

/** Logins: two with one organization role each, one in the group with none. */
export const READER_A = "reader_a";
export const READER_B = "reader_b";
export const READER_NONE = "reader_none";

export async function startScopeHarness(): Promise<ScopeHarness> {
  const pg: LangWatchQLPostgresHarness = await startLangWatchQLPostgres();

  async function runAs({ user, sql }: { user: string; sql: string }): Promise<string> {
    const result =
      user === ADMIN
        ? await pg.asAdmin(sql)
        : await pg.container.exec(
            [
              "psql",
              "-h",
              "127.0.0.1",
              "-U",
              user,
              "-d",
              DATABASE,
              "-v",
              "ON_ERROR_STOP=1",
              "-tAc",
              sql,
            ],
            { env: { PGPASSWORD: PASSWORD } },
          );
    if (result.exitCode !== 0) {
      throw new Error(
        `psql as ${user} failed (${result.exitCode}): ${result.stderr}\n${sql.slice(0, 400)}`,
      );
    }

    return result.stdout.trim();
  }

  const admin = (sql: string) => runAs({ user: ADMIN, sql });

  async function applyAll(statements: string[]): Promise<void> {
    for (const statement of statements) {
      await admin(statement);
    }
  }

  const provisionViews = () =>
    applyAll([
      ...provisioning.postgresApprovedViewStatements({ schema: SCHEMA, readerRole: SHARED_READER }),
      ...provisioning.postgresReaderGrantStatements({ schema: SCHEMA, role: SHARED_READER }),
    ]);

  async function readAllViews(user: string): Promise<RowsByView> {
    const union = VIEW_NAMES.map(
      (name) =>
        `SELECT '${name}' AS n, (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM ${q(SCHEMA)}.${q(name)} x) AS r`,
    ).join(" UNION ALL ");

    return JSON.parse(
      await runAs({ user, sql: `SELECT jsonb_object_agg(n, r) FROM (${union}) s` }),
    );
  }

  async function baselineTenantIds(): Promise<Record<string, string[]>> {
    const selects = VIEWS.map((view) => {
      const joins = view.postgres.tenantPath ?? [];
      const tenantAlias = joins[joins.length - 1]?.alias ?? "m";
      let previous = "m";
      const joinSql = joins
        .map((hop) => {
          const sql = ` JOIN ${q(SCHEMA)}.${q(hop.relation)} AS ${q(hop.alias)} ON ${q(previous)}.${q(hop.on.from)} = ${q(hop.alias)}.${q(hop.on.to)}`;
          previous = hop.alias;
          return sql;
        })
        .join("");
      const filter = view.postgres.rowFilter?.replaceAll("{{schema}}", q(SCHEMA));
      const inner =
        `SELECT ${q(tenantAlias)}.${q(view.postgres.tenantSourceColumn)} AS "TenantId" ` +
        `FROM ${q(SCHEMA)}.${q(view.postgres.baseRelation)} AS "m"${joinSql}${filter ? ` WHERE (${filter})` : ""}`;

      return `SELECT '${view.postgres.approvedView}' AS n, (SELECT coalesce(jsonb_agg("TenantId"), '[]'::jsonb) FROM (${inner}) q) AS r`;
    }).join(" UNION ALL ");

    const unsorted: Record<string, string[]> = JSON.parse(
      await admin(`SELECT jsonb_object_agg(n, r) FROM (${selects}) s`),
    );

    // Sorted here, not by SQL, so both sides of every comparison share one (JS) ordering.
    return Object.fromEntries(
      Object.entries(unsorted).map(([view, ids]) => [view, ids.toSorted()]),
    );
  }

  async function projectOrganizations(): Promise<Record<string, string>> {
    const out = await admin(
      `SELECT jsonb_object_agg(p.id, t."organizationId") FROM ${q(SCHEMA)}."Project" p JOIN ${q(SCHEMA)}."Team" t ON t.id = p."teamId"`,
    );

    return JSON.parse(out);
  }

  const stop = async () => {
    await pg.stop();
  };

  try {
    await admin(`CREATE ROLE ${GROUP} NOLOGIN`);
    await admin(`CREATE ROLE ${SHARED_READER} LOGIN PASSWORD '${PASSWORD}'`);
    for (const org of [ORG_A, ORG_B]) {
      await admin(`CREATE ROLE ${q(orgRole(org))} NOLOGIN`);
    }
    const logins = [
      [READER_A, ORG_A],
      [READER_B, ORG_B],
      [READER_NONE, undefined],
    ] as const;
    for (const [login, org] of logins) {
      await admin(`CREATE ROLE ${login} LOGIN PASSWORD '${PASSWORD}'`);
      await admin(`GRANT ${GROUP} TO ${login} WITH INHERIT TRUE, SET FALSE`);
      if (org) {
        await admin(`GRANT ${q(orgRole(org))} TO ${login} WITH INHERIT FALSE, SET FALSE`);
      }
    }
    await provisionViews();
    // The app's grants name the views; the group reaches only them, never a base table.
    await admin(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${GROUP}`);
  } catch (error) {
    await stop();
    throw error;
  }

  return {
    runAs,
    admin,
    applyAll,
    provisionViews,
    readAllViews,
    baselineTenantIds,
    projectOrganizations,
    stop,
  };
}
