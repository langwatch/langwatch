// A test ClickHouse as the routed query client the fenced analytics reads go through.
import type { ClickHouseClient } from "@clickhouse/client";
import {
  AuthorizedClickHouse,
  type ClickHouseQueryClient,
  type TenantScopedReader,
} from "@langwatch/clickhouse-client";
import { type VendorStatements, vendorQueryClient } from "@langwatch/clickhouse-client/testing";

import { analyticsProof } from "../../../__tests__/analytics-proof.fixture.ts";
import { ANALYTICS_ID_INDEXES } from "../../clickhouse.analytics-id-indexes.database.ts";

/** The suite's connection, with Analytics' id indexes declared as production declares them. */
export function clickHouseQueryClientOver(vendor: VendorStatements): ClickHouseQueryClient {
  return vendorQueryClient({ vendor, indexes: ANALYTICS_ID_INDEXES });
}

/** A connection opened on first use, so a suite that never reads never resolves one. */
export function deferredVendor(open: () => Promise<ClickHouseClient | null>): VendorStatements {
  const client = async (): Promise<ClickHouseClient> => {
    const opened = await open();
    if (!opened) throw new Error("ClickHouse client unavailable");
    return opened;
  };
  return {
    query: async (params) => (await client()).query(params),
    insert: async (params) => (await client()).insert(params),
    command: async (params) => (await client()).command(params),
  };
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
