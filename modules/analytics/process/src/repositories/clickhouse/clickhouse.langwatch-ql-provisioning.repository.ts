import { createClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";

import {
  classifyLwqlAccessModelOwner,
  clickHouseErrorCodeFields,
  clickHouseErrorSummary,
  type ConfigStoreLwqlEntity,
  configStoreEntitiesFromRows,
  configStoreInventoryQuery,
  decideConfigStoreTolerance,
  type LwqlAccessModelIdentity,
  type LwqlAccessModelOwner,
  findMissingObjects,
  findStatementTargets,
  statementKind,
} from "../../rules/langwatch-ql-config-store.rules.ts";
import {
  type ClickHouseAdminStatements,
  LangWatchQLProvisioningRepository,
  type LwqlClickHouseInventory,
  type LwqlKeyMapInsertRow,
  type LwqlPostgresCredentials,
  type ProvisioningFailureLevel,
  type RunClickHouseStatementsResult,
  type SkippedProvisioningStatement,
} from "../langwatch-ql-provisioning.repository.ts";
import { LWQL_KEY_MAP_INSERT_SETTINGS } from "./clickhouse.langwatch-ql-key-map.repository.ts";

const logger = createLogger("langwatch:analytics:lwql:clickhouseRunner");

/** At warn the check logs its own alert, so a text-only alert must not match this line too. */
const FAILED_STATEMENT_MESSAGES: Record<ProvisioningFailureLevel, string> = {
  error: "lwql provisioning failed creating ClickHouse objects",
  warn: "lwql reconvergence statement failed",
};

/** Runs each statement, skipping only the config-store failures the inventory explains. */
async function runClickHouseStatements({
  client,
  statements,
  configStoreEntities = [],
  failureLevel = "error",
}: {
  client: ClickHouseAdminStatements;
  statements: readonly string[];
  configStoreEntities?: readonly ConfigStoreLwqlEntity[];
  failureLevel?: ProvisioningFailureLevel;
}): Promise<RunClickHouseStatementsResult> {
  const skipped: SkippedProvisioningStatement[] = [];
  for (const [index, statement] of statements.entries()) {
    const position = `${index + 1}/${statements.length}`;
    try {
      await client.command(statement);
    } catch (error) {
      const kind = statementKind(statement);
      const targets = findStatementTargets(statement);
      const tolerance = decideConfigStoreTolerance({ error, statement, configStoreEntities });
      if (!tolerance.tolerated) {
        logger[failureLevel](
          {
            error: clickHouseErrorSummary(error),
            ...clickHouseErrorCodeFields(error),
            statement: position,
            kind,
            targets,
            missing: findMissingObjects(error),
          },
          FAILED_STATEMENT_MESSAGES[failureLevel],
        );
        throw error;
      }
      const { code } = tolerance;
      skipped.push({ index: index + 1, code, kind });
      logger.warn(
        { code, statement: position, kind, targets },
        "lwql provisioning skipped a statement whose entity is defined in the ClickHouse config store (read-only) and continued",
      );
    }
  }
  return { skipped };
}

/** The named relations and the named SQL functions present, from two `system` tables. */
async function readClickHouseInventory({
  client,
  database,
  relations,
  functions,
}: {
  client: ClickHouseAdminStatements;
  database: string;
  relations: readonly string[];
  functions: readonly string[];
}): Promise<LwqlClickHouseInventory> {
  const present = await client.rows(
    "SELECT name, comment FROM system.tables " +
      "WHERE database = {database:String} AND has({relations:Array(String)}, name)",
    { database, relations: [...relations] },
  );
  const held =
    functions.length === 0
      ? []
      : await client.rows(
          "SELECT name FROM system.functions " +
            "WHERE origin = 'SQLUserDefined' AND has({functions:Array(String)}, name)",
          { functions: [...functions] },
        );
  return {
    relations: present.map((row) => String(row.name)),
    comments: Object.fromEntries(
      present.map((row) => [String(row.name), typeof row.comment === "string" ? row.comment : ""]),
    ),
    functions: held.map((row) => String(row.name)),
  };
}

/**
 * Dials PostgreSQL through `postgresql(...)` without reading a row; every value is a query
 * parameter, so no password enters the query text. On a cluster each replica reads with its own
 * collection, and one failing fails the read. Every approved view exposes `TenantId`.
 */
async function readThroughPostgres({
  client,
  source,
  params,
  cluster,
}: {
  client: ClickHouseAdminStatements;
  source: string;
  params: Readonly<Record<string, unknown>>;
  cluster: string | undefined;
}): Promise<void> {
  if (cluster === undefined) {
    await client.rows(`DESCRIBE TABLE postgresql(${source})`, params);
    return;
  }
  await client.rows(
    `SELECT count() FROM clusterAllReplicas({cluster:String}, postgresql(${source})) ` +
      "WHERE TenantId = ''",
    { ...params, cluster },
  );
}

/** An unreadable inventory degrades to "none owned", so the statements then fail loudly. */
async function inventoryConfigStoreLwqlEntities({
  client,
  names,
}: {
  client: ClickHouseAdminStatements;
  names: LwqlAccessModelIdentity;
}): Promise<ConfigStoreLwqlEntity[]> {
  const query = configStoreInventoryQuery(names);
  try {
    const entities = configStoreEntitiesFromRows(
      (await client.rows(query)).map((row) => ({
        kind: String(row.kind),
        name: String(row.name),
        database: String(row.database),
        table: String(row.table),
      })),
    );
    if (entities.length > 0) {
      logger.warn(
        { entities },
        "lwql provisioning found LangWatchQL access entities defined in the ClickHouse config store (users.xml) — read-only to SQL, so they are skipped and provisioning continues with the rest",
      );
    }
    return entities;
  } catch (error) {
    logger.warn(
      { error: clickHouseErrorSummary(error) },
      "lwql provisioning could not inventory the ClickHouse config store for pre-defined LangWatchQL entities — continuing",
    );
    return [];
  }
}

/** Throws when ClickHouse is unreachable, so a caller never mistakes an outage for "none". */
async function probeLwqlAccessModelOwner({
  client,
  names,
}: {
  client: ClickHouseAdminStatements;
  names: LwqlAccessModelIdentity;
}): Promise<LwqlAccessModelOwner> {
  await client.rows("SELECT 1");
  const configStoreEntities = await inventoryConfigStoreLwqlEntities({ client, names });
  const rows = await client.rows(
    "SELECT count() AS n FROM system.users WHERE name = {user:String} AND storage != 'users_xml'",
    { user: names.restrictedUser },
  );
  return classifyLwqlAccessModelOwner({
    configStoreEntityCount: configStoreEntities.length,
    sqlStoreUserCount: Number(rows[0]?.n ?? 0),
  });
}

export class ClickHouseLangWatchQLProvisioningRepository extends LangWatchQLProvisioningRepository {
  private constructor(
    private readonly client: ClickHouseAdminStatements,
    private readonly release: () => Promise<void>,
  ) {
    super();
  }

  /** Over the stores' `clickhouseAdmin` statements, which the process owns and closes. */
  static create({
    statements,
  }: {
    statements: ClickHouseAdminStatements;
  }): ClickHouseLangWatchQLProvisioningRepository {
    return new ClickHouseLangWatchQLProvisioningRepository(statements, () => Promise.resolve());
  }

  /** The deploy task's own admin connection, from its resolved `CLICKHOUSE_URL`. */
  static open({ url }: { url: string | undefined }): ClickHouseLangWatchQLProvisioningRepository {
    const client = createClient({ url });
    return new ClickHouseLangWatchQLProvisioningRepository(
      {
        async command(statement) {
          await client.command({ query: statement });
        },
        async rows(sql, params) {
          const result = await client.query({
            query: sql,
            format: "JSONEachRow",
            // In the body: ClickHouse logs a request's URL, query parameters included, at trace.
            ...(params ? { query_params: { ...params }, use_multipart_params: true } : {}),
          });
          return result.json<Record<string, unknown>>();
        },
        async insert({ table, rows, settings }) {
          await client.insert({
            table,
            values: [...rows],
            format: "JSONEachRow",
            ...(settings ? { clickhouse_settings: { ...settings } } : {}),
          });
        },
      },
      () => client.close(),
    );
  }

  runStatements(input: {
    statements: readonly string[];
    configStoreEntities?: readonly ConfigStoreLwqlEntity[];
    failureLevel?: ProvisioningFailureLevel;
  }): Promise<RunClickHouseStatementsResult> {
    return runClickHouseStatements({ client: this.client, ...input });
  }

  readInventory(input: {
    database: string;
    relations: readonly string[];
    functions: readonly string[];
  }): Promise<LwqlClickHouseInventory> {
    return readClickHouseInventory({ client: this.client, ...input });
  }

  /** @param collection Already validated as an identifier by the provisioning service. */
  probePostgresCollection({
    collection,
    relation,
    cluster,
  }: {
    collection: string;
    relation: string;
    cluster: string | undefined;
  }): Promise<void> {
    return readThroughPostgres({
      client: this.client,
      source: `${collection}, table = {relation:String}`,
      params: { relation },
      cluster,
    });
  }

  probePostgresCredentials({
    credentials,
    relation,
    cluster,
  }: {
    credentials: LwqlPostgresCredentials;
    relation: string;
    cluster: string | undefined;
  }): Promise<void> {
    return readThroughPostgres({
      client: this.client,
      cluster,
      source:
        "{address:String}, {database:String}, {relation:String}, {user:String}, {password:String}",
      params: {
        address: `${credentials.host}:${credentials.port}`,
        database: credentials.database,
        relation,
        user: credentials.user,
        password: credentials.password,
      },
    });
  }

  inventoryConfigStore({
    names,
  }: {
    names: LwqlAccessModelIdentity;
  }): Promise<ConfigStoreLwqlEntity[]> {
    return inventoryConfigStoreLwqlEntities({ client: this.client, names });
  }

  probeOwner({ names }: { names: LwqlAccessModelIdentity }): Promise<LwqlAccessModelOwner> {
    return probeLwqlAccessModelOwner({ client: this.client, names });
  }

  queryRows(sql: string): Promise<Record<string, unknown>[]> {
    return this.client.rows(sql);
  }

  /** @param table Already qualified and validated by `keyMapTableQualifiedName`. */
  async findKeyMapHashes({
    table,
    tenantId,
  }: {
    table: string;
    tenantId: string;
  }): Promise<string[]> {
    const rows = await this.client.rows(
      `SELECT DISTINCT KeyHash FROM ${table} WHERE TenantId = {tenantId:String}`,
      { tenantId },
    );
    return rows.flatMap((row) => {
      const hash = row.KeyHash;
      return typeof hash === "string" ? [hash] : [];
    });
  }

  insertKeyMapRows({
    table,
    rows,
  }: {
    table: string;
    rows: readonly LwqlKeyMapInsertRow[];
  }): Promise<void> {
    return this.client.insert({
      table,
      rows: rows.map((row) => ({ KeyHash: row.KeyHash, TenantId: row.TenantId })),
      settings: LWQL_KEY_MAP_INSERT_SETTINGS,
    });
  }

  close(): Promise<void> {
    return this.release();
  }
}
