// A raw test ClickHouse behind the proof-checked reader (as coding-agent suites wrap one).
import type { ClickHouseClient } from "@clickhouse/client";
import {
  AuthorizedClickHouse,
  ClickHouseQueryClient,
  type QueryDriver,
} from "@langwatch/clickhouse-client";

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
  const queryClient = new ClickHouseQueryClient({ driver });
  return new AuthorizedClickHouse({ resolveClient: async () => queryClient });
}
