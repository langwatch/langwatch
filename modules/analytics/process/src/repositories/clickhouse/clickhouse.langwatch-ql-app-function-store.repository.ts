import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  fn,
  systemReplicas,
  systemServerSettings,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import { createLogger } from "@langwatch/observability";

import type { AppFunctionStoreProbe } from "../../features/app-functions/rules/langwatch-ql-app-function-store.rules.ts";
import { LangWatchQLAppFunctionStoreRepository } from "../langwatch-ql-app-function-store.repository.ts";

const logger = createLogger("langwatch:analytics:lwql-app-function-store");

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
      const metadata = tenantScope.serverMetadata({
        reason: "the replica layout and server settings describe the server, which no tenant owns",
      });
      const [replicas, setting] = await Promise.all([
        this.clickhouse.read({
          statement: clickhouseRead({ scope: metadata })
            .from(systemReplicas)
            .select({ max_total_replicas: fn.max(systemReplicas.total_replicas) })
            .build(),
          table: "system.replicas",
        }),
        this.clickhouse.read({
          statement: clickhouseRead({ scope: metadata })
            .from(systemServerSettings)
            .select({ value: systemServerSettings.value })
            .where(({ eq }) => eq(systemServerSettings.name, "user_defined_zookeeper_path"))
            .build(),
          table: "system.server_settings",
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
