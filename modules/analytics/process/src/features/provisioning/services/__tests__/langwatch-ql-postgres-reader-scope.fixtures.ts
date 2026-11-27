/**
 * Shared seeding and query helpers for the reader-scope integration suites. Each suite starts
 * its own container through {@link startScopeHarness}, so no suite depends on another's state.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";

import {
  type LangWatchQLPostgresHarness,
  startLangWatchQLPostgres,
  TENANT_A,
  TENANT_B,
} from "../../../../langwatch-ql/__tests__/lwql-clickhouse-harness.ts";
import type { LwqlProvisioningDatabase } from "../../../../repositories/langwatch-ql-postgres.repository.ts";
import { PrismaLangWatchQLPostgresRepository } from "../../../../repositories/prisma/prisma.langwatch-ql-postgres.repository.ts";
import { LWQL_VIEW_CATALOG } from "../../../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLCatalogShapesService } from "../../../../services/langwatch-ql-catalog-shapes.service.ts";
import type { LwqlConvergencePlan } from "../../../../tasks/lwql-provision.task.ts";
import {
  LWQL_SCOPED_READER_GROUP,
  LWQL_SCOPED_SCHEMA,
  scopedViewGuardCondition,
} from "../../rules/lwql-scoped-view.rules.ts";
import {
  LangWatchQLPostgresGapsService,
  type LwqlPostgresGap,
} from "../langwatch-ql-postgres-gaps.service.ts";
import { LangWatchQLPostgresViewsService } from "../langwatch-ql-postgres-views.service.ts";
import {
  LangWatchQLProductionProvisioningService,
  LWQL_POSTGRES_READER_ROLE,
} from "../langwatch-ql-production-provisioning.service.ts";

export const provisioning = LangWatchQLProductionProvisioningService.create();
const postgresGaps = LangWatchQLPostgresGapsService.create();

export const SCHEMA = "public";
export const SCOPED = LWQL_SCOPED_SCHEMA;
export const SHARED_READER = LWQL_POSTGRES_READER_ROLE;
export const GROUP = LWQL_SCOPED_READER_GROUP;
const DATABASE = "lwtest";
/** The container's superuser: the app's statements run as it unless a suite says otherwise. */
export const ADMIN = "test";
/** Every login the suites create shares it, so any of them can connect over TCP. */
export const LOGIN_PASSWORD = "scope-test-pw";

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

/**
 * A deploy's PostgreSQL statements in production order: the group's revokes, the shared views
 * and the shared reader's grants, then the scoped schema, the copies and the group's grants.
 */
export const deployStatements = (): string[] => [
  ...provisioning.postgresScopedReaderRevokeFirstStatements({ schema: SCHEMA }),
  ...provisioning.postgresApprovedViewStatements({ schema: SCHEMA, readerRole: SHARED_READER }),
  ...provisioning.postgresReaderGrantStatements({ schema: SCHEMA, role: SHARED_READER }),
  ...provisioning.postgresScopedViewStatements({ schema: SCHEMA }),
  ...provisioning.postgresScopedReaderGrantStatements({ schema: SCHEMA }),
];

/**
 * The shared views and shared reader statements production's a6e68647 emits, frozen in the
 * fixture beside this file; each follows a `-- statement N` line after the header.
 */
export const olderConvergeStatements = (): string[] =>
  readFileSync(new URL("./fixtures/older-converge-a6e68647.sql", import.meta.url), "utf8")
    .split(/^-- statement \d+$/m)
    .slice(1)
    .map((statement) => statement.trim());

/** A convergence plan whose PostgreSQL half is real; its ClickHouse half is refused. */
export function postgresOnlyPlan(): LwqlConvergencePlan {
  return {
    request: {
      requested: true,
      complete: true,
      connection: {
        url: "http://127.0.0.1:8123",
        username: "lwql_scope_test",
        password: "restricted-scope-secret",
        database: "langwatch",
        tenantSetting: "custom_api_key_hash",
      },
      postgresReaderPassword: LOGIN_PASSWORD,
      endpoint: { host: "postgres", port: 5432, database: DATABASE },
    },
    names: {
      database: "langwatch",
      restrictedUser: "lwql_scope_test",
      settingsProfile: "lwql_scope_test_profile",
      keyMapTable: "lwql_api_key_tenant_map",
      tenantSetting: "custom_api_key_hash",
    },
    sourceDatabase: () => "langwatch",
    schema: SCHEMA,
    settings: {},
    openRepository: () => {
      throw new Error("the reader-scope suites run no ClickHouse");
    },
  };
}

/** The gaps the reconvergence check reads from PostgreSQL, by the task's own reads. */
export async function readPostgresGaps(
  database: LwqlProvisioningDatabase,
): Promise<LwqlPostgresGap[]> {
  const repository = PrismaLangWatchQLPostgresRepository.create(database);
  const found = await repository.findApprovedViews({
    schema: SCHEMA,
    role: SHARED_READER,
    views: VIEW_NAMES,
  });
  const scoped = await repository.findScopedViewState({
    appSchema: SCHEMA,
    group: GROUP,
    views: VIEW_NAMES,
  });
  return postgresGaps.findGaps({ found, scoped });
}

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

/** A Prisma connection as one login: the way the task reaches PostgreSQL. */
export interface ScopeConnection {
  database: LwqlProvisioningDatabase;
  close: () => Promise<void>;
}

/** One isolated container, seeded and provisioned, with the queries the suites share. */
export interface ScopeHarness {
  /** Runs SQL as the superuser, or as another login over its own connection. */
  runAs: (args: { user: string; sql: string }) => Promise<string>;
  admin: (sql: string) => Promise<string>;
  applyAll: (statements: string[]) => Promise<void>;
  /** The app's own statements, in a deploy's order. */
  provisionViews: () => Promise<void>;
  /** Every view's full rows in `schema`, as one login sees them, in one round trip. */
  readAllViews: (args: { user: string; schema: string }) => Promise<RowsByView>;
  /** TenantIds the shared views expose, derived from base tables and the catalogue paths. */
  baselineTenantIds: () => Promise<Record<string, string[]>>;
  projectOrganizations: () => Promise<Record<string, string>>;
  /** Each copy's stored definition and options, keyed by view, as one JSON text. */
  scopedCopyDefinitions: () => Promise<string>;
  /**
   * An older version's converge, as production's a6e68647 runs it: a look-alike shared view
   * forces the drop-and-create fallback, then that version's own frozen statements for the
   * shared views and the shared reader role. Returns the view it replaced.
   */
  applyOlderConverge: () => Promise<string>;
  /** Relations `role` may select, outside the system schemas. */
  selectableBy: (role: string) => Promise<string[]>;
  /** {@link selectableBy}, less the copies that pass the scoped-view check. */
  unscopedSelectable: (role: string) => Promise<string[]>;
  /** Schemas granted USAGE to `role` itself; PUBLIC's USAGE on `public` is not counted. */
  directSchemaUsage: (role: string) => Promise<string[]>;
  connect: (user: string) => ScopeConnection;
  stop: () => Promise<void>;
}

/** Logins: two with one organization role each, one in the group with none. */
export const READER_A = "reader_a";
export const READER_B = "reader_b";
export const READER_NONE = "reader_none";

/** `provision: false` leaves the views as the base harness made them, for suites that converge. */
export async function startScopeHarness({
  provision = true,
}: { provision?: boolean } = {}): Promise<ScopeHarness> {
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
            { env: { PGPASSWORD: LOGIN_PASSWORD } },
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

  const provisionViews = () => applyAll(deployStatements());

  async function readAllViews({
    user,
    schema,
  }: {
    user: string;
    schema: string;
  }): Promise<RowsByView> {
    const union = VIEW_NAMES.map(
      (name) =>
        `SELECT '${name}' AS n, (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM ${q(schema)}.${q(name)} x) AS r`,
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

  const scopedCopyDefinitions = () =>
    admin(
      `SELECT coalesce(jsonb_object_agg(c.relname, jsonb_build_object(` +
        `'definition', pg_get_viewdef(c.oid), 'options', c.reloptions)), '{}'::jsonb)::text ` +
        `FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace ` +
        `WHERE n.nspname = '${SCOPED}'`,
    );

  async function applyOlderConverge(): Promise<string> {
    const view = VIEW_NAMES[0] as string;
    await admin(`DROP VIEW ${q(SCHEMA)}.${q(view)}`);
    await admin(`CREATE VIEW ${q(SCHEMA)}.${q(view)} AS SELECT 1 AS bogus_column`);
    await applyAll(olderConvergeStatements());
    return view;
  }

  async function selectable({
    role,
    exceptScopedCopies,
  }: {
    role: string;
    exceptScopedCopies: boolean;
  }): Promise<string[]> {
    const exception = exceptScopedCopies
      ? ` AND NOT (n.nspname = '${SCOPED}' AND ${scopedViewGuardCondition({ relation: "c" })})`
      : "";
    const out = await admin(
      `SELECT coalesce(string_agg(format('%I.%I', n.nspname, c.relname), ',' ` +
        `ORDER BY n.nspname, c.relname), '') ` +
        `FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace ` +
        `WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema' ` +
        `AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') ` +
        `AND has_table_privilege('${role}', c.oid, 'SELECT')${exception}`,
    );
    return out === "" ? [] : out.split(",");
  }

  async function directSchemaUsage(role: string): Promise<string[]> {
    const out = await admin(
      `SELECT coalesce(string_agg(n.nspname, ',' ORDER BY n.nspname), '') ` +
        `FROM pg_namespace n, aclexplode(n.nspacl) a ` +
        `WHERE a.grantee = '${role}'::regrole AND a.privilege_type = 'USAGE'`,
    );
    return out === "" ? [] : out.split(",");
  }

  function connect(user: string): ScopeConnection {
    const url = new URL(pg.container.getConnectionUri());
    if (user !== ADMIN) {
      url.username = user;
      url.password = LOGIN_PASSWORD;
    }
    url.searchParams.set("schema", SCHEMA);
    const connection = PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("langwatch:analytics:lwql-reader-scope-test"),
    }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: url.toString(), log: ["error"] }),
    );

    return { database: connection.client, close: () => connection.closeOnce() };
  }

  const stop = async () => {
    await pg.stop();
  };

  try {
    await admin(`CREATE ROLE ${GROUP} NOLOGIN`);
    await admin(`CREATE ROLE ${SHARED_READER} LOGIN PASSWORD '${LOGIN_PASSWORD}'`);
    for (const org of [ORG_A, ORG_B]) {
      await admin(`CREATE ROLE ${q(orgRole(org))} NOLOGIN`);
    }
    const logins = [
      [READER_A, ORG_A],
      [READER_B, ORG_B],
      [READER_NONE, undefined],
    ] as const;
    for (const [login, org] of logins) {
      await admin(`CREATE ROLE ${login} LOGIN PASSWORD '${LOGIN_PASSWORD}'`);
      await admin(`GRANT ${GROUP} TO ${login} WITH INHERIT TRUE, SET FALSE`);
      if (org) {
        await admin(`GRANT ${q(orgRole(org))} TO ${login} WITH INHERIT FALSE, SET FALSE`);
      }
    }
    if (provision) await provisionViews();
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
    scopedCopyDefinitions,
    applyOlderConverge,
    selectableBy: (role) => selectable({ role, exceptScopedCopies: false }),
    unscopedSelectable: (role) => selectable({ role, exceptScopedCopies: true }),
    directSchemaUsage,
    connect,
    stop,
  };
}
