/**
 * LangWatchQL analytics SQL — PostgreSQL-resident data, reached through
 * server-side named collections.
 *
 * `accessModel.ts` builds the ClickHouse access model over objects that
 * already exist. Some LangWatchQL datasets do not live in ClickHouse at all: they
 * are rows in the application's own PostgreSQL primary. This module provisions
 * the path to them, which has a half on each side of the wire:
 *
 *  - **On PostgreSQL** — an approved view per dataset and a dedicated reader
 *    role granted `SELECT` on those views and nothing else. Column-level
 *    exclusions are enforced here, before ClickHouse ever sees a row.
 *  - **On ClickHouse** — a named collection holding the credentials
 *    server-side, and one PostgreSQL-engine table per dataset in the LangWatchQL
 *    database. Those tables are ordinary LangWatchQL objects: the row policies
 *    from `./accessModel.ts` apply to them exactly as they do to a fact table.
 *
 * The tenant column is `TenantId` on both sides by the time a LangWatchQL query
 * sees it — the approved view is where the application's `projectId` takes that
 * name, which is what lets one row-policy shape serve every LangWatchQL object.
 *
 * Every name emitted below is interpolated into SQL text, so it goes through
 * `../sqlText.ts`: `postgresQuoted` on the PostgreSQL side, `assertIdentifier`
 * on the ClickHouse side, and the literal escapers for values.
 *
 * @see ./accessModel.ts — the ClickHouse access model applied over these tables
 * @see ../sqlText.ts — the escaping and identifier rules these statements obey
 * @see specs/lwql/api.feature
 */

import {
  assertIdentifier,
  clickHouseLiteral,
  postgresLiteral,
  postgresQuoted,
} from "../sqlText";
import { assertNames, type LangWatchQLNames, qualified } from "./accessModel";

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
 *
 * Two callers, two ownership models. Self-hosted deployments run this for
 * real via `selfProvisioning.ts` under `LWQL_SELF_PROVISION` (issue #6635),
 * so it is a production path. On cloud the same objects are
 * owned by infra (langwatch-saas#1126) and this stays the reference
 * implementation terraform must match — keep it and its tests in sync with
 * both.
 */
export function postgresNamedCollectionStatements({
  connection,
}: {
  connection: PostgresNamedCollection;
}): string[] {
  assertIdentifier(connection.collection, "named collection");
  if (!Number.isInteger(connection.port)) {
    throw new Error(
      `lwql provisioning: named collection port must be an integer, got ${connection.port}`,
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
export interface LangWatchQLColumn {
  name: string;
  type: string;
}

/**
 * Maps one approved PostgreSQL view into the LangWatchQL database as a
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
  names: LangWatchQLNames;
  table: string;
  columns: LangWatchQLColumn[];
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
      `lwql provisioning: PostgreSQL-engine table "${table}" needs at least one column`,
    );
  }
  if (!Number.isInteger(connectionPoolSize) || connectionPoolSize < 1) {
    throw new Error(
      `lwql provisioning: connectionPoolSize must be a positive integer, got ${connectionPoolSize}`,
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
 * Two rather than one: one serialises every LangWatchQL query touching that
 * dataset behind a single connection, and the point is to bound the primary's
 * exposure, not to remove concurrency. Pair it with
 * `lwqlPostgresReaderConnectionLimit`, which sizes the role's cap above the
 * catalog's total demand so that the cap stays a backstop rather than becoming
 * the thing that fails first.
 */
export const DEFAULT_POSTGRES_ENGINE_POOL_SIZE = 2;

/**
 * The approved PostgreSQL view for one mapped dataset.
 *
 * The boundary the whole PostgreSQL half rests on. The reader role is granted
 * `SELECT` on the views this produces and on nothing else, so a column the
 * catalog does not expose has no path to a LangWatchQL query — it is unreachable
 * rather than merely unselected, which is the property
 * `postgresReaderRoleStatements` documents and this is the other half of.
 *
 * Column names are the catalog's, not the application's: the view is where
 * `projectId` (and, on `Project`, `id`) becomes `TenantId`, which is what lets
 * one row-policy shape serve every LangWatchQL object and lets a caller join
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
  joins = [],
}: {
  schema: string;
  /** Name of the view to create. */
  view: string;
  /** Table in the application's schema it reads, aliased {@link POSTGRES_BASE_ALIAS}. */
  baseRelation: string;
  /**
   * Exposed name, the column behind it, and the alias that column is read on,
   * in catalog order. `alias` defaults to {@link POSTGRES_BASE_ALIAS}; the
   * tenant column names the last {@link joins} hop's alias, which is where the
   * project column actually lives.
   */
  columns: readonly { exposed: string; source: string; alias?: string }[];
  /**
   * The join chain from the base relation to the relation carrying the owning
   * project — {@link LangWatchQLPostgresMapping.tenantPath}. Empty (the default)
   * renders a single-table body, so every path-less view is unchanged bar the
   * new base-alias qualifier.
   */
  joins?: readonly PostgresApprovedViewJoin[];
}): string {
  const quotedSchema = postgresQuoted(schema);
  const quotedView = postgresQuoted(view);
  if (columns.length === 0) {
    throw new Error(
      `lwql provisioning: approved view "${view}" needs at least one column`,
    );
  }
  // The base alias is fixed, so a hop reusing it would make `<m>.<from>`
  // ambiguous between the base relation and that hop; two hops sharing an alias
  // are the same ambiguity between themselves. Caught here rather than left to
  // PostgreSQL so the message names the mapping, not a generated relation.
  const seen = new Set<string>([POSTGRES_BASE_ALIAS]);
  for (const hop of joins) {
    if (hop.relation.length === 0) {
      throw new Error(
        `lwql provisioning: approved view "${view}" has a tenant-path hop with an empty relation`,
      );
    }
    if (seen.has(hop.alias)) {
      throw new Error(
        hop.alias === POSTGRES_BASE_ALIAS
          ? `lwql provisioning: approved view "${view}" tenant-path hop reuses the base alias "${POSTGRES_BASE_ALIAS}"`
          : `lwql provisioning: approved view "${view}" tenant-path reuses alias "${hop.alias}"`,
      );
    }
    seen.add(hop.alias);
  }
  const projection = columns
    .map(
      (column) =>
        `  ${postgresQuoted(column.alias ?? POSTGRES_BASE_ALIAS)}.${postgresQuoted(column.source)} AS ${postgresQuoted(column.exposed)}`,
    )
    .join(",\n");
  let previousAlias = POSTGRES_BASE_ALIAS;
  const joinClause = joins
    .map((hop) => {
      const clause =
        `\nJOIN ${quotedSchema}.${postgresQuoted(hop.relation)} AS ${postgresQuoted(hop.alias)} ` +
        `ON ${postgresQuoted(previousAlias)}.${postgresQuoted(hop.on.from)} = ` +
        `${postgresQuoted(hop.alias)}.${postgresQuoted(hop.on.to)}`;
      previousAlias = hop.alias;
      return clause;
    })
    .join("");
  return (
    `CREATE OR REPLACE VIEW ${quotedSchema}.${quotedView} AS\nSELECT\n${projection}\n` +
    `FROM ${quotedSchema}.${postgresQuoted(baseRelation)} AS ${postgresQuoted(POSTGRES_BASE_ALIAS)}` +
    joinClause
  );
}

/**
 * Alias the approved view's body gives the base relation.
 *
 * Fixed rather than derived: the base relation is the same table in every
 * mapping, so one constant lets the tenant-path hops and the column projection
 * agree on how to name it without threading a value through. A hop may not
 * reuse it — see {@link postgresApprovedViewStatement}.
 */
export const POSTGRES_BASE_ALIAS = "m";

/** One hop of an approved view's tenant join chain, rendered by the view body. */
export interface PostgresApprovedViewJoin {
  /** Relation joined (application table name). */
  readonly relation: string;
  /** Alias this hop's relation gets in the view body. */
  readonly alias: string;
  /** `<previous alias>.<from> = <alias>.<to>`. */
  readonly on: { readonly from: string; readonly to: string };
}

/**
 * The three tenant scopes as reusable join chains, plus a parent prefixer.
 *
 * Pure data: they decide *which* relation carries the project, never any SQL.
 * `projectTenantPath` is empty because a project-scoped table carries the
 * project column itself. `teamTenantPath` joins the base's `teamId` to
 * `Project.teamId`, whose `id` is the project. `organizationTenantPath` cannot
 * hop straight to a project — `Project` has no `organizationId` — so it goes
 * Organization -> Team -> Project through the organization's teams' projects.
 * `parentTenantPath` prefixes the hop to a parent table (foreign key -> its
 * `id`) onto whichever tail the parent's own scope needs.
 *
 * @see LangWatchQLPostgresMapping.tenantPath — the field these fill
 */
export function projectTenantPath(): readonly PostgresApprovedViewJoin[] {
  return [];
}

export function teamTenantPath(): readonly PostgresApprovedViewJoin[] {
  return [
    { relation: "Project", alias: "p", on: { from: "teamId", to: "teamId" } },
  ];
}

export function organizationTenantPath(): readonly PostgresApprovedViewJoin[] {
  return [
    {
      relation: "Team",
      alias: "t",
      on: { from: "organizationId", to: "organizationId" },
    },
    { relation: "Project", alias: "p", on: { from: "id", to: "teamId" } },
  ];
}

export function parentTenantPath({
  parent,
  foreignKey,
  alias,
  tail,
}: {
  /** The parent relation the base table's foreign key points at. */
  parent: string;
  /** The base table's column holding the parent's `id`. */
  foreignKey: string;
  /** Alias the parent relation gets — distinct from the tail's aliases. */
  alias: string;
  /** The parent's own scope hops, appended after the parent hop. */
  tail: readonly PostgresApprovedViewJoin[];
}): readonly PostgresApprovedViewJoin[] {
  return [
    { relation: parent, alias, on: { from: foreignKey, to: "id" } },
    ...tail,
  ];
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
 * `lwqlPostgresReaderConnectionLimit` from `./catalogStatements.ts`, which does that —
 * this constant is what a caller mapping a single table by hand would want.
 *
 * Called for real by self-hosted provisioning (`selfProvisioning.ts`, issue
 * #6635); on cloud the same reader role is infra-owned (langwatch-saas#1126) and this
 * is the reference implementation terraform must match.
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
 *
 * Two callers, two ownership models. Self-hosted deployments run this for real
 * via `selfProvisioning.ts` under `LWQL_SELF_PROVISION` (issue #6635), so it is
 * a production path. On cloud the same role is owned by infra
 * (langwatch-saas#1126) and this stays the reference implementation terraform
 * must match — so keep it and its tests in sync with both.
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
      `lwql provisioning: PostgreSQL role "${reader.role}" needs at least one approved view; ` +
        `a role with no readable relation cannot serve the mapped tables`,
    );
  }
  // Positive, not merely an integer: PostgreSQL reads `CONNECTION LIMIT -1`
  // as unlimited, which silently inverts the budget this limit exists to hold.
  if (!Number.isInteger(reader.connectionLimit) || reader.connectionLimit < 1) {
    throw new Error(
      `lwql provisioning: connectionLimit must be a positive integer, got ${reader.connectionLimit}`,
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
    // Both revokes are needed, and they are not interchangeable. `ON SCHEMA`
    // covers only CREATE and USAGE on the schema itself; the relation-level
    // privileges live on the tables and views and survive it. Without the
    // second statement a relation dropped from `approvedViews` keeps the
    // SELECT it was granted on an earlier run, so the set below would be the
    // views this identity may read *in addition to* whatever it already had,
    // rather than the whole of what it may read.
    `REVOKE ALL ON SCHEMA ${schema} FROM ${role}`,
    `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schema} FROM ${role}`,
    `GRANT USAGE ON SCHEMA ${schema} TO ${role}`,
    ...reader.approvedViews.map(
      (view) => `GRANT SELECT ON ${schema}.${postgresQuoted(view)} TO ${role}`,
    ),
  ];
}
