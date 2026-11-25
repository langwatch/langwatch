import { skipTenantCheck } from "@langwatch/prisma-client";
import { z } from "zod";

import {
  LWQL_SCOPED_SCHEMA,
  scopedSchemaOwnedCondition,
  scopedViewGuardCondition,
} from "../../features/provisioning/rules/lwql-scoped-view.rules.ts";
import { postgresLiteral } from "../../rules/langwatch-ql-sql-literal.rules.ts";
import {
  LangWatchQLPostgresRepository,
  type LwqlPostgresViewFound,
  type LwqlProvisioningDatabase,
  type LwqlScopedViewState,
} from "../langwatch-ql-postgres.repository.ts";

const CATALOG = skipTenantCheck({
  // Provisions LangWatchQL catalog objects shared across every tenant, not scoped to one.
  SKIP_TENANT_CHECK: true,
}).sql;
const approvedViewRowsSchema = z.array(z.object({ view: z.string(), granted: z.boolean() }));
const scopedHeaderRowsSchema = z.tuple([
  z.object({
    groupExists: z.boolean(),
    scopedSchemaExists: z.boolean(),
    scopedSchemaOwned: z.boolean(),
  }),
]);
const scopedViewRowsSchema = z.array(
  z.object({
    view: z.string(),
    groupOnShared: z.boolean(),
    copyExists: z.boolean(),
    copyPassesGuard: z.boolean(),
    copyGranted: z.boolean(),
  }),
);

/** Whether the scoped schema exists, and whose it is by its comment. */
function scopedSchemaOf({
  scopedSchemaExists,
  scopedSchemaOwned,
}: {
  scopedSchemaExists: boolean;
  scopedSchemaOwned: boolean;
}): LwqlScopedViewState["scopedSchema"] {
  if (!scopedSchemaExists) return "absent";
  return scopedSchemaOwned ? "owned" : "foreign";
}

/** The relation the row's `v` names in `schema`, as a lateral join aliased `alias`. */
const relationNamed = ({ schema, alias }: { schema: string; alias: string }) =>
  `LEFT JOIN LATERAL (SELECT k.oid, k.relkind, k.reloptions, k.relnamespace FROM pg_class k ` +
  `JOIN pg_namespace kn ON kn.oid = k.relnamespace ` +
  `WHERE kn.nspname = ${schema} AND k.relname = v) ${alias} ON true `;
const BOOT_LOCK = skipTenantCheck({
  // The self-provision boot lock and its session setting are global, with no tenant scope.
  SKIP_TENANT_CHECK: true,
}).sql;

export class PrismaLangWatchQLPostgresRepository extends LangWatchQLPostgresRepository {
  private constructor(private readonly database: LwqlProvisioningDatabase) {
    super();
  }

  static create(database: LwqlProvisioningDatabase): PrismaLangWatchQLPostgresRepository {
    return new PrismaLangWatchQLPostgresRepository(database);
  }

  async runStatements(statements: readonly string[]): Promise<void> {
    for (const statement of statements) {
      await this.database.$executeRawUnsafe(`${CATALOG}\n${statement}`);
    }
  }

  /** `has_table_privilege` is strict, so an absent role reads as not granted, never an error. */
  async findApprovedViews({
    schema,
    role,
    views,
  }: {
    schema: string;
    role: string;
    views: readonly string[];
  }): Promise<LwqlPostgresViewFound[]> {
    const rows = await this.database.$queryRawUnsafe(
      `${CATALOG}\nSELECT c.relname AS view, ` +
        `coalesce(has_table_privilege(r.oid, c.oid, 'SELECT'), false) AS granted ` +
        `FROM pg_class c ` +
        `JOIN pg_namespace n ON n.oid = c.relnamespace ` +
        `LEFT JOIN pg_roles r ON r.rolname = $2 ` +
        `WHERE n.nspname = $1 AND c.relkind = 'v' AND c.relname = ANY($3::text[])`,
      schema,
      role,
      [...views],
    );
    return approvedViewRowsSchema.parse(rows);
  }

  /**
   * The group is read by oid, so one dropped mid-read reads as not granted rather than raising.
   * Catalog lookups by name, never `to_regclass`, which raises without USAGE on a scoped schema
   * another installation owns.
   */
  async findScopedViewState({
    appSchema,
    group,
    views,
  }: {
    appSchema: string;
    group: string;
    views: readonly string[];
  }): Promise<LwqlScopedViewState> {
    const scopedSchema = postgresLiteral(LWQL_SCOPED_SCHEMA);
    const [header] = scopedHeaderRowsSchema.parse(
      await this.database.$queryRawUnsafe(
        `${CATALOG}\nSELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1::text) AS "groupExists", ` +
          `to_regnamespace(${scopedSchema}) IS NOT NULL AS "scopedSchemaExists", ` +
          `coalesce(${scopedSchemaOwnedCondition({ appSchema })}, false) AS "scopedSchemaOwned"`,
        group,
      ),
    );
    const scopedSchemaState = scopedSchemaOf(header);
    if (!header.groupExists) {
      return { groupExists: false, scopedSchema: scopedSchemaState, groupOnShared: [], copies: [] };
    }
    const rows = scopedViewRowsSchema.parse(
      await this.database.$queryRawUnsafe(
        `${CATALOG}\nSELECT v AS view, ` +
          `coalesce(has_table_privilege(g.oid, s.oid, 'SELECT'), false) AS "groupOnShared", ` +
          `c.oid IS NOT NULL AS "copyExists", ` +
          `coalesce(${scopedViewGuardCondition({ relation: "c" })}, false) AS "copyPassesGuard", ` +
          `coalesce(has_schema_privilege(g.oid, c.relnamespace, 'USAGE') ` +
          `AND has_table_privilege(g.oid, c.oid, 'SELECT'), false) AS "copyGranted" ` +
          `FROM unnest($3::text[]) AS v ` +
          `LEFT JOIN pg_roles g ON g.rolname = $1::text ` +
          relationNamed({ schema: "$2::text", alias: "s" }) +
          relationNamed({ schema: scopedSchema, alias: "c" }) +
          `ORDER BY v`,
        group,
        appSchema,
        [...views],
      ),
    );
    return {
      groupExists: true,
      scopedSchema: scopedSchemaState,
      groupOnShared: rows.filter((row) => row.groupOnShared).map((row) => row.view),
      copies: rows.map((row) => ({
        view: row.view,
        exists: row.copyExists,
        passesGuard: row.copyPassesGuard,
        granted: row.copyGranted,
      })),
    };
  }

  withAdvisoryLock<T>({
    key,
    timeoutMs,
    maxWaitMs,
    fn,
  }: {
    key: string;
    timeoutMs: number;
    maxWaitMs: number;
    fn: () => Promise<T>;
  }): Promise<T> {
    return this.database.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `${BOOT_LOCK}SELECT pg_advisory_xact_lock(hashtextextended('${key}', 0))`,
        );
        await tx.$executeRawUnsafe(`${BOOT_LOCK}SET LOCAL idle_in_transaction_session_timeout = 0`);
        return fn();
      },
      { timeout: timeoutMs, maxWait: maxWaitMs },
    );
  }
}
