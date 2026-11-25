// A raw test ClickHouse behind the proof-checked reader, as the trace suites wrap one, with
// evaluation's id indexes declared as the module declares them, so an id-bound read expands.
import type { ClickHouseClient } from "@clickhouse/client";
import {
  AuthorizedClickHouse,
  ClickHouseQueryClient,
  type QueryDriver,
  TenantGuard,
} from "@langwatch/clickhouse-client";

import {
  EVALUATION_ID_INDEXES,
  EVALUATION_SECOND_ID_INDEXES,
} from "../../clickhouse.evaluation-id-indexes.database.ts";

export function authorizedClickHouseFor(client: ClickHouseClient): AuthorizedClickHouse {
  const driver: QueryDriver = {
    async execute(request) {
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
      return { rows: await result.json() };
    },
    async insert(request) {
      await client.insert({
        table: request.table,
        values: request.rows,
        format: "JSONEachRow",
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
    },
    async command(request) {
      await client.command({
        query: request.sql,
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
    },
  };
  const queryClient = new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
  queryClient.declareIdIndexes({
    indexes: [...EVALUATION_ID_INDEXES, ...EVALUATION_SECOND_ID_INDEXES],
  });
  return new AuthorizedClickHouse({ resolveClient: async () => queryClient });
}
