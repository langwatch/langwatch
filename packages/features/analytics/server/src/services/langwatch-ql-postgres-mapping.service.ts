/**
 * @see ./provisioning.ts — the ClickHouse access model applied over these tables
 * @see ./sql-text.ts — the escaping and identifier rules these statements obey
 * @see specs/analytics/lwql-api.feature
 */

import {
  LangWatchQLAccessModelService,
  type LangWatchQLNames,
} from "./langwatch-ql-access-model.service";
import { clickHouseLiteral, postgresLiteral } from "../rules/langwatch-ql-sql-literal.rules";
import { LangWatchQLSqlTextService } from "./langwatch-ql-sql-text.service";

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
  }: {
    schema: string;
    /** Name of the view to create. */
    view: string;
    /** Table in the application's schema it reads. */
    baseRelation: string;
    /** Exposed name and the base relation's column behind it, in catalog order. */
    columns: readonly { exposed: string; source: string }[];
  }): string {
    const quotedSchema = sqlText.postgresQuoted(schema);
    const quotedView = sqlText.postgresQuoted(view);
    if (columns.length === 0) {
      throw new Error(`lwql provisioning: approved view "${view}" needs at least one column`);
    }

    const projection = columns
      .map(
        (column) =>
          `  ${sqlText.postgresQuoted(column.source)} AS ${sqlText.postgresQuoted(column.exposed)}`,
      )
      .join(",\n");

    return (
      `CREATE OR REPLACE VIEW ${quotedSchema}.${quotedView} AS\nSELECT\n${projection}\n` +
      `FROM ${quotedSchema}.${sqlText.postgresQuoted(baseRelation)}`
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
