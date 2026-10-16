import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";

import {
  APP_FUNCTION_KEEPER_STORE,
  APP_FUNCTION_KEEPER_STORE_PATH,
  type AppFunctionStoreProbe,
  type AppFunctionStoreReadings,
  isFunctionStoreInKeeper,
  needsKeeperFunctionStore,
} from "../../features/app-functions/rules/langwatch-ql-app-function-store.rules.ts";
import { LangWatchQLAppFunctionStoreRepository } from "../langwatch-ql-app-function-store.repository.ts";
import type { LangWatchQLProvisioningRepository } from "../langwatch-ql-provisioning.repository.ts";

const logger = createLogger("langwatch:analytics:lwql-app-function-store");

type ReadRows = (sql: string) => Promise<Record<string, unknown>[]>;

const MAX_TOTAL_REPLICAS_SQL =
  "SELECT toString(max(total_replicas)) AS max_total_replicas FROM system.replicas";

const KEEPER_FUNCTION_STORE_SQL =
  "SELECT toString(count()) AS stores FROM system.zookeeper " +
  `WHERE path = '${APP_FUNCTION_KEEPER_STORE.parent}' AND name = '${APP_FUNCTION_KEEPER_STORE.name}'`;

const KEEPER_FUNCTION_ENTRIES_SQL = `SELECT name FROM system.zookeeper WHERE path = '${APP_FUNCTION_KEEPER_STORE_PATH}'`;

// system.functions is local to this server, so it says which store this server reads.
const SERVER_SQL_FUNCTIONS_SQL =
  "SELECT name FROM system.functions WHERE origin = 'SQLUserDefined'";

/**
 * Reads the replica layout and, only when replicated, whether this server keeps its
 * functions in Keeper: a server with no Keeper has no `system.zookeeper` to ask. A
 * server that cannot answer answers nothing, so it is never taken for a single node.
 */
export class ClickHouseLangWatchQLAppFunctionStoreRepository extends LangWatchQLAppFunctionStoreRepository {
  private constructor(private readonly rows: ReadRows) {
    super();
  }

  static create(
    clickhouse: ClickHouseQueryClient,
  ): ClickHouseLangWatchQLAppFunctionStoreRepository {
    return new ClickHouseLangWatchQLAppFunctionStoreRepository(async (sql) => {
      const result = await clickhouse.query<Record<string, unknown>>({
        tenantId: "",
        sql,
        // The replica layout and the Keeper store describe the server, which no tenant owns.
        SKIP_TENANT_CHECK: true,
      });
      return result.rows;
    });
  }

  /** Over the deploy task's admin connection, the one that then creates the functions. */
  static overAdmin(
    admin: Pick<LangWatchQLProvisioningRepository, "queryRows">,
  ): ClickHouseLangWatchQLAppFunctionStoreRepository {
    return new ClickHouseLangWatchQLAppFunctionStoreRepository((sql) => admin.queryRows(sql));
  }

  async findProbe(): Promise<AppFunctionStoreProbe[]> {
    try {
      const replicas = await this.rows(MAX_TOTAL_REPLICAS_SQL);
      const maxTotalReplicas = Number(replicas[0]?.max_total_replicas ?? "0") || 0;
      if (!needsKeeperFunctionStore(maxTotalReplicas)) {
        return [{ maxTotalReplicas, functionStoreInKeeper: false }];
      }
      const readings = await this.readFunctionStore();
      return [{ maxTotalReplicas, functionStoreInKeeper: isFunctionStoreInKeeper(readings) }];
    } catch (error) {
      logger.error(
        { error },
        "Could not read the replica layout from system.replicas or the function store from system.zookeeper and system.functions, so LangWatchQL app functions are not provisionable until it can",
      );
      return [];
    }
  }

  private async readFunctionStore(): Promise<AppFunctionStoreReadings> {
    const [node] = await this.rows(KEEPER_FUNCTION_STORE_SQL);
    if (Number(node?.stores ?? "0") === 0) {
      return { storeNodeExists: false, serverFunctions: [], storeEntries: [] };
    }
    const [functions, entries] = await Promise.all([
      this.rows(SERVER_SQL_FUNCTIONS_SQL),
      this.rows(KEEPER_FUNCTION_ENTRIES_SQL),
    ]);
    return {
      storeNodeExists: true,
      serverFunctions: functions.map((row) => String(row.name)),
      storeEntries: entries.map((row) => String(row.name)),
    };
  }
}
