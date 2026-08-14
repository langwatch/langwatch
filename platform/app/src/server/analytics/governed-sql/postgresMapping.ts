/**
 * Governed analytics SQL — PostgreSQL-resident data, reached through
 * server-side named collections.
 *
 * `provisioning.ts` builds the ClickHouse access model over objects that
 * already exist. Some governed datasets do not live in ClickHouse at all: they
 * are rows in the application's own PostgreSQL primary. This module provisions
 * the path to them, which has a half on each side of the wire:
 *
 *  - **On PostgreSQL** — an approved view per dataset and a dedicated reader
 *    role granted `SELECT` on those views and nothing else. Column-level
 *    exclusions are enforced here, before ClickHouse ever sees a row.
 *  - **On ClickHouse** — a named collection holding the credentials
 *    server-side, and one PostgreSQL-engine table per dataset in the governed
 *    database. Those tables are ordinary governed objects: the row policies
 *    from `./provisioning.ts` apply to them exactly as they do to a fact table.
 *
 * The tenant column is `TenantId` on both sides by the time a governed query
 * sees it — the approved view is where the application's `projectId` takes that
 * name, which is what lets one row-policy shape serve every governed object.
 *
 * Every name emitted below is interpolated into SQL text, so it goes through
 * `./sqlText.ts`: `postgresQuoted` on the PostgreSQL side, `assertIdentifier`
 * on the ClickHouse side, and the literal escapers for values.
 *
 * @see ./provisioning.ts — the ClickHouse access model applied over these tables
 * @see ./sqlText.ts — the escaping and identifier rules these statements obey
 * @see specs/analytics/governed-sql-api.feature
 */

import { assertNames, type GovernedSqlNames, qualified } from "./provisioning";
import {
  assertIdentifier,
  clickHouseLiteral,
  postgresLiteral,
  postgresQuoted,
} from "./sqlText";

/** Connection details of the named collection ClickHouse dials PostgreSQL with. */
export interface PostgresNamedCollection {
  /** Collection name, referenced by the PostgreSQL-engine tables. */
  collection: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * Creates the named collection holding the PostgreSQL credentials server-side.
 *
 * Credentials live in the collection, never in a table definition and never in
 * a query: the restricted identity is granted neither `NAMED COLLECTION` nor
 * `SHOW NAMED COLLECTIONS`, so `SHOW CREATE TABLE` on a mapped table reveals
 * the collection's *name* and nothing more.
 *
 * Dropped first rather than `IF NOT EXISTS`, so re-provisioning against a host
 * whose address has changed converges instead of silently keeping the old one.
 */
export function postgresNamedCollectionStatements({
  connection,
}: {
  connection: PostgresNamedCollection;
}): string[] {
  assertIdentifier(connection.collection, "named collection");
  if (!Number.isInteger(connection.port)) {
    throw new Error(
      `governed-sql provisioning: named collection port must be an integer, got ${connection.port}`,
    );
  }
  return [
    `DROP NAMED COLLECTION IF EXISTS ${connection.collection}`,
    `CREATE NAMED COLLECTION ${connection.collection} AS ` +
      `host=${clickHouseLiteral(connection.host)}, ` +
      `port=${connection.port}, ` +
      `database=${clickHouseLiteral(connection.database)}, ` +
      `user=${clickHouseLiteral(connection.user)}, ` +
      `password=${clickHouseLiteral(connection.password)}`,
  ];
}

/** A column of a PostgreSQL-engine table, in ClickHouse types. */
export interface GovernedColumn {
  name: string;
  type: string;
}

/**
 * Maps one approved PostgreSQL view into the governed database as a
 * PostgreSQL-engine table.
 *
 * The mapped object is a *view* on the PostgreSQL side, not a base table:
 * column-level exclusions (content-gated fields) are enforced by the view
 * definition and by the PG role's grants, before ClickHouse ever sees a row.
 */
export function postgresEngineTableStatement({
  names,
  table,
  columns,
  collection,
  postgresRelation,
  connectionPoolSize = DEFAULT_POSTGRES_ENGINE_POOL_SIZE,
}: {
  names: GovernedSqlNames;
  table: string;
  columns: GovernedColumn[];
  collection: string;
  postgresRelation: string;
  /** Connections this one mapped table may hold open. See the constant. */
  connectionPoolSize?: number;
}): string {
  assertNames(names);
  assertIdentifier(collection, "named collection");
  assertIdentifier(postgresRelation, "postgresRelation");
  if (columns.length === 0) {
    throw new Error(
      `governed-sql provisioning: PostgreSQL-engine table "${table}" needs at least one column`,
    );
  }
  if (!Number.isInteger(connectionPoolSize) || connectionPoolSize < 1) {
    throw new Error(
      `governed-sql provisioning: connectionPoolSize must be a positive integer, got ${connectionPoolSize}`,
    );
  }
  const columnList = columns
    .map(
      (column) => `${assertIdentifier(column.name, "column")} ${column.type}`,
    )
    .join(", ");
  return (
    `CREATE TABLE IF NOT EXISTS ${qualified(names, table)} (${columnList}) ` +
    `ENGINE = PostgreSQL(${collection}, table=${clickHouseLiteral(postgresRelation)}) ` +
    `SETTINGS postgresql_connection_pool_size = ${connectionPoolSize}`
  );
}

/**
 * Connections one mapped table may hold open against the primary.
 *
 * The demand on the primary is *per mapped table*, not per deployment:
 * ClickHouse builds a connection pool for each PostgreSQL-engine storage, so a
 * catalog of six datasets asks for six pools. At the server default of 16 that
 * is up to 96 connections from the analytics path alone — measured, an
 * unbounded pool grew to 5 connections for a single table under eight
 * concurrent reads, and six tables exhausted a `CONNECTION LIMIT` of 5 with
 * *idle pooled* connections, which then refused the role's next login outright.
 *
 * Two rather than one: one serialises every governed query touching that
 * dataset behind a single connection, and the point is to bound the primary's
 * exposure, not to remove concurrency. Pair it with
 * `governedPostgresReaderConnectionLimit`, which sizes the role's cap above the
 * catalog's total demand so that the cap stays a backstop rather than becoming
 * the thing that fails first.
 */
export const DEFAULT_POSTGRES_ENGINE_POOL_SIZE = 2;

/**
 * The approved PostgreSQL view for one mapped dataset.
 *
 * The boundary the whole PostgreSQL half rests on. The reader role is granted
 * `SELECT` on the views this produces and on nothing else, so a column the
 * catalog does not expose has no path to a governed query — it is unreachable
 * rather than merely unselected, which is the property
 * `postgresReaderRoleStatements` documents and this is the other half of.
 *
 * Column names are the catalog's, not the application's: the view is where
 * `projectId` (and, on `Project`, `id`) becomes `TenantId`, which is what lets
 * one row-policy shape serve every governed object and lets a caller join
 * across residences without knowing which side is which.
 *
 * `CREATE OR REPLACE` rather than `IF NOT EXISTS`, matching the ClickHouse
 * views: re-provisioning after the catalog changed must converge, and a view
 * that silently kept an older column list would keep exposing a column the
 * catalog no longer claims. PostgreSQL refuses to `REPLACE` a view whose
 * existing columns are not a prefix of the new ones, so a removed or retyped
 * column fails loudly at provisioning time instead.
 */
export function postgresApprovedViewStatement({
  schema,
  view,
  baseRelation,
  columns,
}: {
  schema: string;
  /** Name of the view to create. */
  view: string;
  /** Table in the application's schema it reads. */
  baseRelation: string;
  /** Exposed name and the base relation's column behind it, in catalog order. */
  columns: readonly { exposed: string; source: string }[];
}): string {
  const quotedSchema = postgresQuoted(schema);
  const quotedView = postgresQuoted(view);
  if (columns.length === 0) {
    throw new Error(
      `governed-sql provisioning: approved view "${view}" needs at least one column`,
    );
  }
  const projection = columns
    .map(
      (column) =>
        `  ${postgresQuoted(column.source)} AS ${postgresQuoted(column.exposed)}`,
    )
    .join(",\n");
  return (
    `CREATE OR REPLACE VIEW ${quotedSchema}.${quotedView} AS\nSELECT\n${projection}\n` +
    `FROM ${quotedSchema}.${postgresQuoted(baseRelation)}`
  );
}

/** How the dedicated PostgreSQL role is constrained. */
export interface PostgresReaderRole {
  role: string;
  password: string;
  /** Schema the approved views live in. */
  schema: string;
  /** Views — never base tables — the role may read. */
  approvedViews: string[];
  connectionLimit: number;
  /** PostgreSQL interval literal, e.g. `10s`. */
  statementTimeout: string;
}

/**
 * Matches the ClickHouse-side ceilings, so neither layer outlives the other.
 *
 * `connectionLimit` is a *floor for a one-table deployment* and is not the
 * number a real catalog should use: the demand is per mapped table, so the cap
 * has to be derived from how many there are. Use
 * `governedPostgresReaderConnectionLimit` from `../views.ts`, which does that —
 * this constant is what a caller mapping a single table by hand would want.
 */
export const DEFAULT_POSTGRES_READER_LIMITS = {
  connectionLimit: 5,
  statementTimeout: "10s",
} as const;

/**
 * Provisions the dedicated PostgreSQL role the named collection connects as.
 *
 * Three independent limits, none of which relies on ClickHouse behaving:
 * `default_transaction_read_only` makes every statement the role can issue a
 * read (ClickHouse wraps its reads in `BEGIN READ ONLY` regardless, but the
 * role does not depend on that); `statement_timeout` bounds a single query's
 * load on the primary; `CONNECTION LIMIT` bounds how much of the primary's
 * connection budget the analytics path can take.
 *
 * The role is granted `SELECT` on the approved views only. Base tables stay
 * unreadable, so a column dropped from a view is unreachable rather than merely
 * unselected.
 *
 * Idempotent: existence is settled once, then every property is converged with
 * `ALTER`, so re-provisioning an already-configured server is a no-op.
 */
export function postgresReaderRoleStatements({
  reader,
}: {
  reader: PostgresReaderRole;
}): string[] {
  // Quoted, like every other PostgreSQL identifier this module emits — and the
  // existence probe compares `rolname` against the *unquoted* spelling on
  // purpose: `CREATE ROLE "ChReader"` stores `ChReader`, so an unquoted create
  // would store `chreader`, never match the probe, and make every re-run try to
  // create a role that already exists.
  const role = postgresQuoted(reader.role);
  const schema = postgresQuoted(reader.schema);
  if (reader.approvedViews.length === 0) {
    throw new Error(
      `governed-sql provisioning: PostgreSQL role "${reader.role}" needs at least one approved view; ` +
        `a role with no readable relation cannot serve the mapped tables`,
    );
  }
  // Positive, not merely an integer: PostgreSQL reads `CONNECTION LIMIT -1`
  // as unlimited, which silently inverts the budget this limit exists to hold.
  if (!Number.isInteger(reader.connectionLimit) || reader.connectionLimit < 1) {
    throw new Error(
      `governed-sql provisioning: connectionLimit must be a positive integer, got ${reader.connectionLimit}`,
    );
  }
  return [
    `DO $$\nBEGIN\n` +
      `  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${postgresLiteral(reader.role)}) THEN\n` +
      `    EXECUTE 'CREATE ROLE ${role} LOGIN';\n` +
      `  END IF;\nEND\n$$`,
    `ALTER ROLE ${role} WITH LOGIN PASSWORD ${postgresLiteral(reader.password)} ` +
      `CONNECTION LIMIT ${reader.connectionLimit}`,
    `ALTER ROLE ${role} SET default_transaction_read_only = on`,
    `ALTER ROLE ${role} SET statement_timeout = ${postgresLiteral(reader.statementTimeout)}`,
    `REVOKE ALL ON SCHEMA ${schema} FROM ${role}`,
    `GRANT USAGE ON SCHEMA ${schema} TO ${role}`,
    ...reader.approvedViews.map(
      (view) => `GRANT SELECT ON ${schema}.${postgresQuoted(view)} TO ${role}`,
    ),
  ];
}
