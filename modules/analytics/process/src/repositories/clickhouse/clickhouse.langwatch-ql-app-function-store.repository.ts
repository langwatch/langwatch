import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";

import type { AppFunctionStoreProbe } from "../../rules/langwatch-ql-app-function-store.rules.ts";
import { LangWatchQLAppFunctionStoreRepository } from "../langwatch-ql-app-function-store.repository.ts";

const logger = createLogger("langwatch:analytics:lwql-app-function-store");

const UNSCOPED = {
  reason: "the replica layout and server settings describe the server, which no tenant owns",
} as const;

/**
 * Reads the replica layout and the UDF store setting. A server that cannot
 * answer (no `system.server_settings`, no access to `system.replicas`) answers
 * nothing, so a replicated server is never mistaken for a single node.
 */
export class ClickHouseLangWatchQLAppFunctionStoreRepository extends LangWatchQLAppFunctionStoreRepository {
  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
  }

  static create(
    clickhouse: ClickHouseQueryClient,
  ): ClickHouseLangWatchQLAppFunctionStoreRepository {
    return new ClickHouseLangWatchQLAppFunctionStoreRepository(clickhouse);
  }

  async findProbe(): Promise<AppFunctionStoreProbe[]> {
    try {
      const [replicas, setting] = await Promise.all([
        this.clickhouse.query<{ max_total_replicas: string }>({
          tenantId: "",
          sql: "SELECT toString(max(total_replicas)) AS max_total_replicas FROM system.replicas",
          unscoped: UNSCOPED,
        }),
        this.clickhouse.query<{ value: string }>({
          tenantId: "",
          sql: "SELECT value FROM system.server_settings WHERE name = 'user_defined_zookeeper_path'",
          unscoped: UNSCOPED,
        }),
      ]);
      return [
        {
          maxTotalReplicas: Number(replicas.rows[0]?.max_total_replicas ?? "0") || 0,
          userDefinedZookeeperPath: setting.rows[0]?.value ?? "",
        },
      ];
    } catch (error) {
      logger.error(
        { error },
        "Could not read the replica layout from system.replicas and system.server_settings, so LangWatchQL app functions are not provisionable until it can",
      );
      return [];
    }
  }
}
