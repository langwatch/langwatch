/**
 * Production LangWatchQL provisioning — pure composition only.
 * @see specs/analytics/lwql-api.feature
 */

import { LangWatchQLCapabilityService } from "./langwatch-ql-capability.service.ts";

import { LWQL_VIEW_CATALOG } from "../rules/lwql-view-catalog.rules.ts";
import type { LangWatchQLViewDefinition } from "../services/langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLCatalogShapesService } from "../services/langwatch-ql-catalog-shapes.service.ts";
import type { LangWatchQLConnection } from "../ports/langwatch-ql-executor.port.ts";
import {
  KEY_MAP_COLUMNS,
  LangWatchQLAccessModelService,
  type LangWatchQLNames,
} from "../services/langwatch-ql-access-model.service.ts";
import { postgresLiteral } from "../rules/langwatch-ql-sql-literal.rules.ts";
import { LangWatchQLSqlTextService } from "./langwatch-ql-sql-text.service.ts";

import { SHIPPED_LWQL_DEDUP } from "../services/langwatch-ql-view-statements.service.ts";
import { LangWatchQLPostgresViewsService } from "../services/langwatch-ql-postgres-views.service.ts";
import { LangWatchQLViewStatementsService } from "../services/langwatch-ql-view-statements.service.ts";

const postgresViews = LangWatchQLPostgresViewsService.create();
const viewStatements = LangWatchQLViewStatementsService.create();

const accessModel = LangWatchQLAccessModelService.create();

const catalogShapes = LangWatchQLCatalogShapesService.create();

const lwqlCapability = LangWatchQLCapabilityService.create();
const sqlText = LangWatchQLSqlTextService.create();

/**
 * Literal, hard-coded match for the table name the SaaS row-filter subqueries
 * already reference (see migration 00084). Not derived from `names.database`
 * or any env var — infra's filters name this table by this exact string.
 */
export const LWQL_KEY_MAP_TABLE = "lwql_api_key_tenant_map";

/** PostgreSQL schema the approved views live in when the URL names none. */
export const LWQL_POSTGRES_SCHEMA = "public";

/**
 * The PostgreSQL role the ClickHouse named collection dials as. Provisioned
 * out of band (terraform in the cloud, self-provisioning elsewhere); this
 * module only ever grants it read access to views it just created.
 */
export const LWQL_POSTGRES_READER_ROLE = "lwql_ro";

/** One project's key-map row candidate. */
export interface LwqlKeyMapRow {
  KeyHash: string;
  TenantId: string;
}

/** What a backfill run against the current key-map table needs to do. */
export interface LwqlKeyMapBackfillPlan {
  rowsToInsert: LwqlKeyMapRow[];
  /**
   * Project ids whose `lwqlKey` was empty/blank. Never silently dropped: an empty key means
   * that project's LangWatchQL access is unreachable, which is the exact failure this backfill
   * exists to prevent, so the caller must log these loudly rather than skip them quietly.
   */
  blankKeyProjectIds: string[];
}

/** Which of the generated SQL a real deploy runs, and in what order. */
export class LangWatchQLProductionProvisioningService {
  static create(): LangWatchQLProductionProvisioningService {
    return new LangWatchQLProductionProvisioningService();
  }

  private constructor() {}

  /**
   * The schema the application's tables actually live in, read from the connection URL's
   * `schema` query parameter (the same one Prisma honours).
   */
  postgresSchemaFromDatabaseUrl(databaseUrl: string | undefined): string {
    if (!databaseUrl) {
      return LWQL_POSTGRES_SCHEMA;
    }

    let url: URL;
    try {
      url = new URL(databaseUrl);
    } catch {
      throw new Error(
        "lwql provisioning: DATABASE_URL is set but not a parseable URL, cannot determine the PostgreSQL schema for the approved views",
      );
    }

    // `||`, not `??`: a bare `?schema=` means "no schema named", the same way
    // `prismaPgAdapter.ts` reads this URL — not a request for a view named "".
    return url.searchParams.get("schema") || LWQL_POSTGRES_SCHEMA;
  }

  /**
   * Builds the object names a production deploy provisions under, from the validated `LWQL_*`
   * connection.
   */
  names({ connection }: { connection: LangWatchQLConnection }): LangWatchQLNames {
    return {
      database: connection.database,
      restrictedUser: connection.username,
      settingsProfile: `${connection.database}_profile`,
      keyMapTable: LWQL_KEY_MAP_TABLE,
      tenantSetting: connection.tenantSetting,
    };
  }

  /**
   * The key-map table's accessModel.qualified name. Always migration 00084's table, created
   * under the app's own ClickHouse database (`sourceDatabase`, matching goose's
   * `${CLICKHOUSE_DATABASE}`) — the same database infra's row filters already reference.
   */
  keyMapTableQualifiedName({
    names,
    sourceDatabase,
  }: {
    names: LangWatchQLNames;
    sourceDatabase: string;
  }): string {
    return accessModel.qualified(names, names.keyMapTable, sourceDatabase);
  }

  /**
   * ClickHouse-native views only.
   */
  clickHouseObjectStatements({
    names,
    sourceDatabase,
    views = LWQL_VIEW_CATALOG,
  }: {
    names: LangWatchQLNames;
    sourceDatabase: string;
    views?: readonly LangWatchQLViewDefinition[];
  }): string[] {
    return [
      `CREATE DATABASE IF NOT EXISTS ${names.database}`,
      ...views
        .filter((view) => !catalogShapes.isPostgresResident(view))
        .map((view) =>
          viewStatements.viewStatement({
            names,
            sourceDatabase,
            view,
            dedup: SHIPPED_LWQL_DEDUP,
          }),
        ),
    ];
  }

  /**
   * The PostgreSQL-side approved views. Independent of ClickHouse credentials —
   * always runs.
   */
  postgresApprovedViewStatements({
    schema = LWQL_POSTGRES_SCHEMA,
    views = LWQL_VIEW_CATALOG,
  }: {
    /** From {@link lwqlPostgresSchemaFromDatabaseUrl} in a real deploy. */
    schema?: string;
    views?: readonly LangWatchQLViewDefinition[];
  } = {}): string[] {
    return postgresViews.approvedViewStatements({
      schema,
      views,
    });
  }

  /**
   * Grants the reader role SELECT on every approved view, to be run straight after {@link
   * productionPostgresApprovedViewStatements} creates them. This exists because the two halves
   * are provisioned by different systems on different schedules.
   */
  postgresReaderGrantStatements({
    schema = LWQL_POSTGRES_SCHEMA,
    role = LWQL_POSTGRES_READER_ROLE,
    views = LWQL_VIEW_CATALOG,
  }: {
    schema?: string;
    role?: string;
    views?: readonly LangWatchQLViewDefinition[];
  } = {}): string[] {
    const approvedViews = postgresViews.approvedViewNames(views);
    if (approvedViews.length === 0) {
      return [];
    }

    const quotedSchema = sqlText.postgresQuoted(schema);
    const quotedRole = sqlText.postgresQuoted(role);
    const grants = [
      `GRANT USAGE ON SCHEMA ${quotedSchema} TO ${quotedRole}`,
      ...approvedViews.map(
        (view) =>
          `GRANT SELECT ON ${quotedSchema}.${sqlText.postgresQuoted(view)} TO ${quotedRole}`,
      ),
    ];

    // One guarded block rather than a probe followed by grants: the check and
    // the grants have to be the same statement, or a role dropped between them
    // turns a no-op into a failed deploy.
    return [
      `DO $$\nBEGIN\n` +
        `  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${postgresLiteral(role)}) THEN\n` +
        grants.map((grant) => `    EXECUTE ${postgresLiteral(grant)};\n`).join("") +
        `  END IF;\nEND\n$$`,
    ];
  }

  /**
   * Diffs every project's key hash against the key-map table's current rows and returns only
   * what is missing.
   */
  planKeyMapBackfill({
    projects,
    existingHashes,
  }: {
    projects: readonly { id: string; lwqlKey: string }[];
    existingHashes: ReadonlySet<string>;
  }): LwqlKeyMapBackfillPlan {
    const rowsToInsert: LwqlKeyMapRow[] = [];
    const blankKeyProjectIds: string[] = [];
    const plannedHashes = new Set<string>();

    for (const project of projects) {
      if (!project.lwqlKey) {
        blankKeyProjectIds.push(project.id);
        continue;
      }

      const hash = lwqlCapability.tenantCapability({ secret: project.lwqlKey });
      const isAlreadyMapped = existingHashes.has(hash) || plannedHashes.has(hash);
      if (isAlreadyMapped) {
        continue;
      }

      plannedHashes.add(hash);
      rowsToInsert.push({
        [KEY_MAP_COLUMNS.keyHash]: hash,
        [KEY_MAP_COLUMNS.tenantId]: project.id,
      });
    }

    return { rowsToInsert, blankKeyProjectIds };
  }

  /**
   * The sanctioned opt-out `guardProjectId` accepts on a raw PostgreSQL statement that
   * intentionally has no tenancy predicate.
   */
  withTenancyOptOut(statement: string): string {
    return `-- @tenancy: provisions LangWatchQL catalog objects shared across every tenant, not scoped to one\n${statement}`;
  }
}
