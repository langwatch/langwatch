import { createClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";

import {
  classifyLwqlAccessModelOwner,
  clickHouseErrorSummary,
  type ConfigStoreLwqlEntity,
  configStoreEntitiesFromRows,
  configStoreInventoryQuery,
  decideConfigStoreTolerance,
  type LwqlAccessModelIdentity,
  type LwqlAccessModelOwner,
  statementKind,
} from "../../rules/langwatch-ql-config-store.rules.ts";
import {
  type ClickHouseAdminStatements,
  LangWatchQLProvisioningRepository,
  type LwqlKeyMapInsertRow,
  type RunClickHouseStatementsResult,
  type SkippedProvisioningStatement,
} from "../langwatch-ql-provisioning.repository.ts";
import { LWQL_KEY_MAP_INSERT_SETTINGS } from "./clickhouse.langwatch-ql-key-map.repository.ts";

const logger = createLogger("langwatch:analytics:lwql:clickhouseRunner");

/** Runs each statement, skipping only the config-store failures the inventory explains. */
async function runClickHouseStatements({
  client,
  statements,
  configStoreEntities = [],
}: {
  client: ClickHouseAdminStatements;
  statements: readonly string[];
  configStoreEntities?: readonly ConfigStoreLwqlEntity[];
}): Promise<RunClickHouseStatementsResult> {
  const skipped: SkippedProvisioningStatement[] = [];
  for (const [index, statement] of statements.entries()) {
    const position = `${index + 1}/${statements.length}`;
    try {
      await client.command(statement);
    } catch (error) {
      const kind = statementKind(statement);
      const tolerance = decideConfigStoreTolerance({ error, statement, configStoreEntities });
      if (!tolerance.tolerated) {
        logger.error(
          { error: clickHouseErrorSummary(error), statement: position, kind },
          "lwql provisioning failed creating ClickHouse objects",
        );
        throw error;
      }
      const { code } = tolerance;
      skipped.push({ index: index + 1, code, kind });
      logger.warn(
        { code, statement: position, kind },
        "lwql provisioning skipped a statement whose entity is defined in the ClickHouse config store (read-only) and continued",
      );
    }
  }
  return { skipped };
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
            ...(params ? { query_params: { ...params } } : {}),
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
  }): Promise<RunClickHouseStatementsResult> {
    return runClickHouseStatements({ client: this.client, ...input });
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
  async findKeyMapHashes({ table }: { table: string }): Promise<string[]> {
    const rows = await this.queryRows(`SELECT DISTINCT KeyHash FROM ${table}`);
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
