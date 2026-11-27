/**
 * Production LangWatchQL provisioning — pure composition only.
 * @see specs/lwql/api.feature
 */

import type { LangWatchQLConnection } from "../../../repositories/langwatch-ql-executor.repository.ts";
import { postgresLiteral } from "../../../rules/langwatch-ql-sql-literal.rules.ts";
import { LWQL_VIEW_CATALOG } from "../../../rules/lwql-view-catalog.rules.ts";
import {
  KEY_MAP_COLUMNS,
  LangWatchQLAccessModelService,
  type LangWatchQLNames,
} from "../../../services/langwatch-ql-access-model.service.ts";
import { LangWatchQLCapabilityService } from "../../../services/langwatch-ql-capability.service.ts";
import type { LangWatchQLViewDefinition } from "../../../services/langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLSqlTextService } from "../../../services/langwatch-ql-sql-text.service.ts";
import {
  LWQL_SCOPED_READER_GROUP,
  LWQL_SCOPED_SCHEMA,
  LWQL_PROJECT_KEYS_VIEW,
  scopedCopyLookup,
  scopedSchemaOwnedCondition,
  scopedSchemaStatement,
  scopedViewGuardCondition,
} from "../rules/lwql-scoped-view.rules.ts";
import { LangWatchQLPostgresViewsService } from "./langwatch-ql-postgres-views.service.ts";

const postgresViews = LangWatchQLPostgresViewsService.create();

const accessModel = LangWatchQLAccessModelService.create();

const lwqlCapability = LangWatchQLCapabilityService.create();
const sqlText = LangWatchQLSqlTextService.create();

/**
 * Literal, hard-coded match for the table name the SaaS row-filter subqueries
 * already reference (see migration 00084). Not derived from `names.database`
 * or any env var — infra's filters name this table by this exact string.
 */
const LWQL_KEY_MAP_TABLE = "lwql_api_key_tenant_map";

/** PostgreSQL schema the approved views live in when the URL names none. */
const LWQL_POSTGRES_SCHEMA = "public";

/**
 * The shared PostgreSQL reader the ClickHouse named collection dials as, whose reads keep every
 * row. Provisioned out of band (terraform in the cloud, self-provisioning elsewhere); this module
 * only ever grants it read access to views it just created.
 */
export const LWQL_POSTGRES_READER_ROLE = "lwql_ro";

const QUOTED_GROUP = sqlText.postgresQuoted(LWQL_SCOPED_READER_GROUP);

/** The scoped-reader group's guarded block: `body` runs only when the group exists. */
function whenGroupExists({ body }: { body: readonly string[] }): string {
  return (
    `DO $$\nBEGIN\n` +
    `  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${postgresLiteral(LWQL_SCOPED_READER_GROUP)}) THEN\n` +
    body.join("") +
    `  END IF;\nEND\n$$`
  );
}

/** The group's grant on one copy: SELECT when it passes the scoped-view check, else revoked. */
function scopedCopyGrant({ view }: { view: string }): string {
  const copy = `${sqlText.postgresQuoted(LWQL_SCOPED_SCHEMA)}.${sqlText.postgresQuoted(view)}`;
  const lookup = scopedCopyLookup({ view });

  return (
    `      IF EXISTS (SELECT 1 ${lookup} AND ${scopedViewGuardCondition({ relation: "c" })}) THEN\n` +
    `        EXECUTE ${postgresLiteral(`GRANT SELECT ON ${copy} TO ${QUOTED_GROUP}`)};\n` +
    `      ELSIF EXISTS (SELECT 1 ${lookup}) THEN\n` +
    `        EXECUTE ${postgresLiteral(`REVOKE SELECT ON ${copy} FROM ${QUOTED_GROUP}`)};\n` +
    `      END IF;\n`
  );
}

/** Revokes the group's SELECT on one copy that fails the scoped-view check; grants nothing. */
function scopedCopyRevoke({ view }: { view: string }): string {
  const copy = `${sqlText.postgresQuoted(LWQL_SCOPED_SCHEMA)}.${sqlText.postgresQuoted(view)}`;
  const guard = scopedViewGuardCondition({ relation: "c" });

  return (
    `      IF EXISTS (SELECT 1 ${scopedCopyLookup({ view })} AND NOT ${guard}) THEN\n` +
    `        EXECUTE ${postgresLiteral(`REVOKE SELECT ON ${copy} FROM ${QUOTED_GROUP}`)};\n` +
    `      END IF;\n`
  );
}

/** One project's key-map row candidate. */
export interface LwqlKeyMapRow {
  KeyHash: string;
  TenantId: string;
}

/** What a backfill run against the current key-map table needs to do. */
interface LwqlKeyMapBackfillPlan {
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
   * The PostgreSQL-side approved views. Independent of ClickHouse credentials —
   * always runs.
   */
  postgresApprovedViewStatements({
    schema = LWQL_POSTGRES_SCHEMA,
    views = LWQL_VIEW_CATALOG,
    readerRole,
  }: {
    /** From {@link lwqlPostgresSchemaFromDatabaseUrl} in a real deploy. */
    schema?: string;
    views?: readonly LangWatchQLViewDefinition[];
    /** Re-granted `SELECT` if a view's fallback drop-and-create path runs. */
    readerRole?: string;
  } = {}): string[] {
    return postgresViews.approvedViewStatements({
      schema,
      views,
      ...(readerRole !== undefined ? { readerRole } : {}),
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
   * Run before any view DDL, so no rewrite can leave the scoped-reader group a grant: revokes its
   * USAGE on the app schema, its SELECT on every shared view, and its SELECT on every copy in
   * this installation's scoped schema that fails the scoped-view check. Revokes only.
   */
  postgresScopedReaderRevokeFirstStatements({
    schema = LWQL_POSTGRES_SCHEMA,
    views = LWQL_VIEW_CATALOG,
  }: {
    schema?: string;
    views?: readonly LangWatchQLViewDefinition[];
  } = {}): string[] {
    const quotedSchema = sqlText.postgresQuoted(schema);
    const approvedViews = postgresViews.approvedViewNames(views);
    const sharedRevokes = approvedViews.map((view) => {
      const shared = `${quotedSchema}.${sqlText.postgresQuoted(view)}`;
      return (
        `    IF to_regclass(${postgresLiteral(shared)}) IS NOT NULL THEN\n` +
        `      EXECUTE ${postgresLiteral(`REVOKE SELECT ON ${shared} FROM ${QUOTED_GROUP}`)};\n` +
        `    END IF;\n`
      );
    });

    return [
      whenGroupExists({
        body: [
          `    EXECUTE ${postgresLiteral(`REVOKE USAGE ON SCHEMA ${quotedSchema} FROM ${QUOTED_GROUP}`)};\n`,
          ...sharedRevokes,
          // Another installation's copies are its own to guard; this one's role cannot read them.
          `    IF ${scopedSchemaOwnedCondition({ appSchema: schema })} THEN\n`,
          ...approvedViews.map((view) => scopedCopyRevoke({ view })),
          `    END IF;\n`,
        ],
      }),
    ];
  }

  /**
   * The scoped schema when absent, then the copies of `views` in it. All of it runs only when the
   * scoped-reader group exists, and the copies only in this installation's scoped schema.
   */
  postgresScopedViewStatements({
    schema = LWQL_POSTGRES_SCHEMA,
    views = LWQL_VIEW_CATALOG,
  }: {
    schema?: string;
    views?: readonly LangWatchQLViewDefinition[];
  } = {}): string[] {
    return [
      scopedSchemaStatement({ appSchema: schema }),
      ...postgresViews.scopedViewStatements({ schema, views }),
    ];
  }

  /**
   * Grants the scoped-reader group USAGE on this installation's scoped schema, and SELECT on each
   * copy that passes the scoped-view check; a copy that fails it has SELECT revoked. Nothing runs
   * without the group, or when the scoped schema is absent or another installation's.
   */
  postgresScopedReaderGrantStatements({
    schema = LWQL_POSTGRES_SCHEMA,
    views = LWQL_VIEW_CATALOG,
  }: {
    schema?: string;
    views?: readonly LangWatchQLViewDefinition[];
  } = {}): string[] {
    const usage = `GRANT USAGE ON SCHEMA ${sqlText.postgresQuoted(LWQL_SCOPED_SCHEMA)} TO ${QUOTED_GROUP}`;

    return [
      whenGroupExists({
        body: [
          `    IF ${scopedSchemaOwnedCondition({ appSchema: schema })} THEN\n`,
          `      EXECUTE ${postgresLiteral(usage)};\n`,
          ...postgresViews.approvedViewNames(views).map((view) => scopedCopyGrant({ view })),
          `    END IF;\n`,
        ],
      }),
    ];
  }

  /**
   * The scoped project-key copy a private ClickHouse's row policies read, and its guarded grant:
   * the copy first, then the group's SELECT only if it passes the scoped-view check, else revoked.
   * Nothing runs without the group or outside this installation's scoped schema.
   */
  postgresProjectKeysStatements({
    schema = LWQL_POSTGRES_SCHEMA,
  }: { schema?: string } = {}): string[] {
    return [
      postgresViews.projectKeysScopedViewStatement({ schema }),
      whenGroupExists({
        body: [
          `    IF ${scopedSchemaOwnedCondition({ appSchema: schema })} THEN\n`,
          scopedCopyGrant({ view: LWQL_PROJECT_KEYS_VIEW }),
          `    END IF;\n`,
        ],
      }),
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
}
