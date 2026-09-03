import type { ClickHouseClient, ClickHouseSettings } from "@clickhouse/client";

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
 * Resolves and queries the ClickHouse client behind the operator-only
 * `/api/ops/clickhouse/explain` endpoint.
 *
 * No `TenantId` scoping, deliberately: the clickhouse-optimizer agent this
 * endpoint serves legitimately runs EXPLAINs across the whole fleet, which
 * is why this repository sits outside the tenant-scoped access pattern
 * every other repository follows.
 */
export class OpsExplainClickHouseRepository {
  constructor(private readonly resolver: OpsExplainClientResolver) {}

  /**
   * The dedicated `langwatch_ops` readonly user when `CLICKHOUSE_OPS_URL`
   * is configured, else the injected shared client as a fallback.
   * Null when neither is configured on this instance.
   */
  resolveClient(): OpsExplainClientResolution | null {
    return this.resolver.resolve();
  }

  /**
   * Runs the (already server-wrapped) EXPLAIN query. `guardrails` are
   * ClickHouse settings sent only for the fallback client — the
   * `langwatch_ops` user's `readonly_safe` profile forbids client-side
   * setting modifications and already enforces the same caps server-side.
   */
  async runExplain({
    client,
    wrappedQuery,
    guardrails,
  }: {
    client: ClickHouseClient;
    wrappedQuery: string;
    guardrails?: ClickHouseSettings;
  }): Promise<unknown[]> {
    const result = await client.query({
      query: wrappedQuery,
      format: "JSONEachRow",
      ...(guardrails ? { clickhouse_settings: guardrails } : {}),
    });
    return result.json();
  }
}
