import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";

import {
  type AppFunctionStoreProbe,
  readAppFunctionStoreProbe,
} from "../../features/app-functions/rules/langwatch-ql-app-function-store.rules.ts";
import { LangWatchQLAppFunctionStoreRepository } from "../langwatch-ql-app-function-store.repository.ts";

const logger = createLogger("langwatch:analytics:lwql-app-function-store");

/**
 * Reads the replica layout and, on a replicated server, the function store's node in
 * Keeper. A server that cannot answer (no access to `system.replicas` or
 * `system.zookeeper`) answers nothing, so it is never mistaken for a single node.
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
      const probe = await readAppFunctionStoreProbe({
        queryRows: async (sql) => {
          const result = await this.clickhouse.query<Record<string, unknown>>({
            tenantId: "",
            sql,
            // The replica layout and Keeper describe the server, which no tenant owns.
            SKIP_TENANT_CHECK: true,
          });
          return result.rows;
        },
      });
      return [probe];
    } catch (error) {
      logger.error(
        { error },
        "Could not read the replica layout from system.replicas or the function store from system.zookeeper, so LangWatchQL app functions are not provisionable until it can",
      );
      return [];
    }
  }
}
