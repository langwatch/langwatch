import type { ClickHouseClient } from "@clickhouse/client";

/** The API composition root owns tenant routing and client construction. */
export type GovernanceClickHouseClientResolver = (tenantId: string) => Promise<ClickHouseClient>;
