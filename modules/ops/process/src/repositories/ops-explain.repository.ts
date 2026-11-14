import type { ClickHouseClient } from "@clickhouse/client";

/** The dedicated `langwatch_ops` client an EXPLAIN runs on; there is no fallback (ADR-202). */
export interface OpsExplainClientResolution {
  client: ClickHouseClient;
}

/**
 * The ClickHouse account an EXPLAIN runs as, as the worker resolves it. Null where
 * `CLICKHOUSE_OPS_URL` is unset, and always in the api role.
 */
export interface OpsExplainClients {
  findClient(): OpsExplainClientResolution | null;
}

/**
 * The one call this repository makes, as it asks for it. Narrower than the
 * driver client so the fleet-wide EXPLAIN can skip the tenant check.
 */
export interface OpsExplainQueryClient {
  query(input: {
    query: string;
    format: "JSONEachRow";
    SKIP_TENANT_CHECK?: true;
  }): Promise<{ json(): Promise<unknown[]> }>;
}

/**
 * Resolving and running the operator-only EXPLAIN, as the service asks for it.
 */
export abstract class OpsExplainRepository {
  /** The dedicated `langwatch_ops` readonly user, or null where it is not configured. */
  abstract findClient(): OpsExplainClientResolution | null;

  /** Runs the (already server-wrapped) EXPLAIN; the ops user's profile enforces the caps. */
  abstract runExplain(params: {
    client: OpsExplainQueryClient;
    wrappedQuery: string;
  }): Promise<unknown[]>;
}
