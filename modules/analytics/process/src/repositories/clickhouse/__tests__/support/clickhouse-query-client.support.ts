// A test ClickHouse as the routed query client the fenced analytics reads go through.
import type { ClickHouseClient } from "@clickhouse/client";
import {
  AuthorizedClickHouse,
  ClickHouseQueryClient,
  type QueryDriver,
  TenantGuard,
  type TenantScopedReader,
} from "@langwatch/clickhouse-client";

import { analyticsProof } from "../../../__tests__/analytics-proof.fixture.ts";

/** One ClickHouse for every tenant, or the client each tenant resolves to. */
type ClientSource = ClickHouseClient | ((tenantId: string) => Promise<ClickHouseClient | null>);

export function clickHouseQueryClientOver(source: ClientSource): ClickHouseQueryClient {
  const clientFor = async (tenantId: string): Promise<ClickHouseClient> => {
    const client = typeof source === "function" ? await source(tenantId) : source;
    if (!client) throw new Error(`ClickHouse client unavailable for ${tenantId}`);
    return client;
  };
  const driver: QueryDriver = {
    async execute(request) {
      const client = await clientFor(request.tenantId);
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
      return { rows: await result.json() };
    },
    async insert(request) {
      const client = await clientFor(request.tenantId);
      await client.insert({
        table: request.table,
        values: request.rows,
        format: "JSONEachRow",
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
    },
    async command(request) {
      const client = await clientFor(request.tenantId);
      await client.command({
        query: request.sql,
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
    },
  };
  return new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
}

/**
 * The reader a fenced statement (slim or rollup) is sent through under the project's own proof,
 * as the repository sends it: the proof fills the statement's tenant markers (ADR-177).
 */
export function ownProjectReaderOver({
  client,
  projectId,
}: {
  client: ClickHouseClient;
  projectId: string;
}): TenantScopedReader {
  const queryClient = clickHouseQueryClientOver(client);
  return new AuthorizedClickHouse({ resolveClient: () => Promise.resolve(queryClient) }).as(
    analyticsProof({ projectId }),
    { reads: "analytics" },
  );
}
