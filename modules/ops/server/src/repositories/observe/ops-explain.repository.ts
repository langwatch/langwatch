import type { ClickHouseClient, ClickHouseSettings } from "@clickhouse/client";

/** Which client an EXPLAIN resolved to, and whether it is the dedicated one. */
export interface OpsExplainClientResolution {
  client: ClickHouseClient;
  /**
   * True when the dedicated `langwatch_ops` readonly user is not configured on
   * this instance and the call fell back to the default-user shared client.
   */
  usingFallback: boolean;
}

/**
 * The ClickHouse account an EXPLAIN runs as, as the PROCESS resolves it. Null
 * where neither the dedicated user nor a shared client is configured.
 */
export interface OpsExplainClients {
  findClient(): OpsExplainClientResolution | null;
}

/**
 * The one call this repository makes, as it asks for it. Narrower than the
 * driver client so the fleet-wide EXPLAIN can carry its `unscoped` reason.
 */
export interface OpsExplainQueryClient {
  query(input: {
    query: string;
    format: "JSONEachRow";
    clickhouse_settings?: ClickHouseSettings;
    unscoped?: { reason: string };
  }): Promise<{ json(): Promise<unknown[]> }>;
}

/**
 * Resolving and running the operator-only EXPLAIN, as the service asks for it.
 */
export abstract class OpsExplainRepository {
  /**
   * The dedicated `langwatch_ops` readonly user when `CLICKHOUSE_OPS_URL`
   * is configured, else the injected shared client as a fallback.
   * Null when neither is configured on this instance.
   */
  abstract findClient(): OpsExplainClientResolution | null;

  /**
   * Runs the (already server-wrapped) EXPLAIN query. `guardrails` are
   * ClickHouse settings sent only for the fallback client: the `langwatch_ops`
   * user's `readonly_safe` profile forbids client-side setting changes and
   * already enforces the same caps server-side.
   */
  abstract runExplain(params: {
    client: OpsExplainQueryClient;
    wrappedQuery: string;
    guardrails?: ClickHouseSettings;
  }): Promise<unknown[]>;
}
