import type { ClickHouseClient, ClickHouseSettings } from "@clickhouse/client";

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

export interface OpsExplainClientResolution {
  client: ClickHouseClient;
  /** True when the dedicated `langwatch_ops` readonly user is not
   *  configured on this instance and the call fell back to the
   *  default-user shared client. */
  usingFallback: boolean;
}

/** Complete composition port for selecting the dedicated or shared client. */
export abstract class OpsExplainClientResolver {
  abstract resolve(): OpsExplainClientResolution | null;
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
  abstract resolveClient(): OpsExplainClientResolution | null;

  /**
   * Runs the (already server-wrapped) EXPLAIN query. `guardrails` are ClickHouse settings sent only for
   * the fallback client — the `langwatch_ops` user's `readonly_safe` profile forbids client-side setting
   * modifications and already enforces the same caps server-side.
   */
  abstract runExplain(params: {
    client: OpsExplainQueryClient;
    wrappedQuery: string;
    guardrails?: ClickHouseSettings;
  }): Promise<unknown[]>;
}
