/**
 * @see ./provisioning.ts — the ClickHouse access model applied over these tables
 * @see ./sql-text.ts — the escaping and identifier rules these statements obey
 * @see specs/lwql/api.feature
 */

import { clickHouseLiteral, postgresLiteral } from "../rules/langwatch-ql-sql-literal.rules.ts";
import type { PostgresApprovedViewJoin } from "../rules/lwql-tenant-paths.rules.ts";
import {
  LangWatchQLAccessModelService,
  type LangWatchQLNames,
} from "./langwatch-ql-access-model.service.ts";
import { LangWatchQLSqlTextService } from "./langwatch-ql-sql-text.service.ts";

const accessModel = LangWatchQLAccessModelService.create();

const sqlText = LangWatchQLSqlTextService.create();

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

/** A column of a PostgreSQL-engine table, in ClickHouse types. */
export interface LangWatchQLColumn {
  name: string;
  type: string;
}

/**
 * Connections one mapped table may hold open against the primary. The demand on the primary is
 * *per mapped table*, not per deployment: ClickHouse builds a connection pool for each
 * PostgreSQL-engine storage, so a catalog of six datasets asks for six pools.
 */
export const DEFAULT_POSTGRES_ENGINE_POOL_SIZE = 2;

/**
 * Alias the approved view's body gives the base relation. Fixed rather than
 * derived, so the tenant-path hops and the column projection agree on how to
 * name it without threading a value through. A hop may not reuse it.
 */
export const POSTGRES_BASE_ALIAS = "m";

/** The `DO` block's dollar-quote tag. */
const APPROVED_VIEW_DOLLAR_TAG = "$lwql$";

/** Refuses a view body already carrying the outer `DO` block's own tag. */
function assertNoDollarTagCollision({ view, body }: { view: string; body: string }): void {
  if (body.includes(APPROVED_VIEW_DOLLAR_TAG)) {
    throw new Error(
      `lwql provisioning: approved view "${view}" body contains the reserved ` +
        `dollar-quote tag ${APPROVED_VIEW_DOLLAR_TAG}`,
    );
  }
}

/**
 * The fallback branch's guarded re-grant, run only when the `DROP`+`CREATE` path
 * actually drops the view. Empty when the caller does not know the reader role.
 */
function readerRegrantClause({
  readerRole,
  qualifiedView,
}: {
  readerRole: string | undefined;
  qualifiedView: string;
}): string {
  if (!readerRole) {
    return "";
  }

  return (
    `\n    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${postgresLiteral(readerRole)}) THEN\n` +
    `      GRANT SELECT ON ${qualifiedView} TO ${sqlText.postgresQuoted(readerRole)};\n` +
    `    END IF;`
  );
}

/** A defined-but-blank `rowFilter` is refused rather than read as no filter. */
function assertRowFilterNotBlank({
  view,
  rowFilter,
}: {
  view: string;
  rowFilter: string | undefined;
}): void {
  if (rowFilter !== undefined && rowFilter.trim().length === 0) {
    throw new Error(`lwql provisioning: approved view "${view}" has a blank rowFilter`);
  }
}

/**
 * The base alias is fixed, so a hop reusing it would make `"m".<from>` ambiguous
 * between the base relation and that hop; two hops sharing an alias are the same
 * ambiguity between themselves.
 */
function assertJoinAliasesDistinct({
  view,
  joins,
}: {
  view: string;
  joins: readonly PostgresApprovedViewJoin[];
}): void {
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
 * Matches the ClickHouse-side ceilings, so neither layer outlives the other. `connectionLimit`
 * is a *floor for a one-table deployment* and is not the number a real catalog should use: the
 * demand is per mapped table, so the cap has to be derived from how many there are.
 */
export const DEFAULT_POSTGRES_READER_LIMITS = {
  connectionLimit: 5,
  statementTimeout: "10s",
} as const;

/** The PostgreSQL-resident datasets, as the statements that map them into ClickHouse. */
export class LangWatchQLPostgresMappingService {
  static create(): LangWatchQLPostgresMappingService {
    return new LangWatchQLPostgresMappingService();
  }

  private constructor() {}

  /**
   * Creates the named collection holding the PostgreSQL credentials server-side.
   */
  namedCollectionStatements({ connection }: { connection: PostgresNamedCollection }): string[] {
    sqlText.assertIdentifier(connection.collection, "named collection");
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

  /**
   * Maps one approved PostgreSQL view into the LangWatchQL database as a PostgreSQL-engine
   * table.
   */
  engineTableStatement({
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
    accessModel.assertNames(names);
    sqlText.assertIdentifier(collection, "named collection");
    sqlText.assertIdentifier(postgresRelation, "postgresRelation");
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
      .map((column) => `${sqlText.assertIdentifier(column.name, "column")} ${column.type}`)
      .join(", ");

    return (
      `CREATE TABLE IF NOT EXISTS ${accessModel.qualified(names, table)} (${columnList}) ` +
      `ENGINE = PostgreSQL(${collection}, table=${clickHouseLiteral(postgresRelation)}) ` +
      `SETTINGS postgresql_connection_pool_size = ${connectionPoolSize}`
    );
  }

  /**
   * The approved PostgreSQL view for one mapped dataset. The boundary the whole PostgreSQL half
   * rests on.
   */
  approvedViewStatement({
    schema,
    view,
    baseRelation,
    columns,
    joins = [],
    rowFilter,
    readerRole,
  }: {
    schema: string;
    /** Name of the view to create. */
    view: string;
    /** Table in the application's schema it reads, aliased {@link POSTGRES_BASE_ALIAS}. */
    baseRelation: string;
    /**
     * Exposed name, the column behind it, and the alias it is read on, in
     * catalog order. `alias` defaults to {@link POSTGRES_BASE_ALIAS}; the tenant
     * column names the last {@link joins} hop's alias, where the project lives.
     */
    columns: readonly { exposed: string; source: string; alias?: string }[];
    /**
     * The join chain from the base relation to the relation carrying the owning
     * project. Empty renders a single-table body.
     */
    joins?: readonly PostgresApprovedViewJoin[];
    /**
     * A visibility rule ANDed into the view's WHERE clause. A defined-but-blank
     * filter is refused rather than silently read as "no restriction". May
     * contain `{{schema}}`, replaced with this call's quoted schema.
     */
    rowFilter?: string;
    /**
     * The reader role to re-grant `SELECT` to if this run takes the fallback
     * `DROP`+`CREATE` path — the only path that can lose the grant, since
     * `CREATE OR REPLACE VIEW` never touches privileges.
     */
    readerRole?: string;
  }): string {
    const quotedSchema = sqlText.postgresQuoted(schema);
    const quotedView = sqlText.postgresQuoted(view);
    const qualifiedView = `${quotedSchema}.${quotedView}`;
    if (columns.length === 0) {
      throw new Error(`lwql provisioning: approved view "${view}" needs at least one column`);
    }

    assertRowFilterNotBlank({ view, rowFilter });
    assertJoinAliasesDistinct({ view, joins });
    const projection = columns
      .map(
        (column) =>
          `  ${sqlText.postgresQuoted(column.alias ?? POSTGRES_BASE_ALIAS)}.` +
          `${sqlText.postgresQuoted(column.source)} AS ${sqlText.postgresQuoted(column.exposed)}`,
      )
      .join(",\n");
    let previousAlias = POSTGRES_BASE_ALIAS;
    const joinClause = joins
      .map((hop) => {
        const clause =
          `\nJOIN ${quotedSchema}.${sqlText.postgresQuoted(hop.relation)} AS ${sqlText.postgresQuoted(hop.alias)} ` +
          `ON ${sqlText.postgresQuoted(previousAlias)}.${sqlText.postgresQuoted(hop.on.from)} = ` +
          `${sqlText.postgresQuoted(hop.alias)}.${sqlText.postgresQuoted(hop.on.to)}`;
        previousAlias = hop.alias;

        return clause;
      })
      .join("");
    // The catalog author writes `rowFilter` once, before any deployment's schema
    // is known, so a filter naming a sibling relation cannot spell that schema
    // literally; `{{schema}}` defers it to this call's actual schema.
    const resolvedRowFilter = rowFilter?.replaceAll("{{schema}}", quotedSchema);
    const whereClause = resolvedRowFilter ? `\nWHERE (${resolvedRowFilter})` : "";
    const body =
      `SELECT\n${projection}\n` +
      `FROM ${quotedSchema}.${sqlText.postgresQuoted(baseRelation)} AS ${sqlText.postgresQuoted(POSTGRES_BASE_ALIAS)}` +
      joinClause +
      whereClause;
    assertNoDollarTagCollision({ view, body });
    // `CREATE OR REPLACE VIEW` refuses a changed column list; the fallback drops
    // and recreates, which is the only path that loses the reader's grant, so
    // that branch — and only that branch — re-grants it.
    const regrant = readerRegrantClause({ readerRole, qualifiedView });

    return (
      `DO ${APPROVED_VIEW_DOLLAR_TAG}\n` +
      `BEGIN\n` +
      `  CREATE OR REPLACE VIEW ${qualifiedView} AS\n${body};\n` +
      `EXCEPTION\n` +
      `  WHEN feature_not_supported OR invalid_table_definition THEN\n` +
      `    DROP VIEW IF EXISTS ${qualifiedView};\n` +
      `    CREATE VIEW ${qualifiedView} AS\n${body};${regrant}\n` +
      `END\n${APPROVED_VIEW_DOLLAR_TAG}`
    );
  }

  /**
   * Provisions the dedicated PostgreSQL role the named collection connects as.
   */
  readerRoleStatements({ reader }: { reader: PostgresReaderRole }): string[] {
    // Quoted, like every other PostgreSQL identifier this module emits — and the
    // existence probe compares `rolname` against the *unquoted* spelling on
    // purpose: `CREATE ROLE "ChReader"` stores `ChReader`, so an unquoted create
    // would store `chreader`, never match the probe, and make every re-run try to
    // create a role that already exists.
    const role = sqlText.postgresQuoted(reader.role);
    const schema = sqlText.postgresQuoted(reader.schema);
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
      // Both revokes are needed, and they are not interchangeable. `ON SCHEMA` covers only
      // CREATE and USAGE on the schema itself; the relation-level privileges live on the tables
      // and views and survive it.
      `REVOKE ALL ON SCHEMA ${schema} FROM ${role}`,
      `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schema} FROM ${role}`,
      `GRANT USAGE ON SCHEMA ${schema} TO ${role}`,
      ...reader.approvedViews.map(
        (view) => `GRANT SELECT ON ${schema}.${sqlText.postgresQuoted(view)} TO ${role}`,
      ),
    ];
  }
}
