import { createClient, type ClickHouseClient, type ClickHouseSettings } from "@clickhouse/client";
import { findOpsConnection } from "../../rules/ops-clickhouse-explain.rules.ts";
import {
  OpsExplainRepository,
  type OpsExplainClientResolution,
  type OpsExplainClients,
  type OpsExplainQueryClient,
} from "../ops-explain.repository.ts";

/**
 * Resolves and queries the ClickHouse client behind the operator-only
 * `/api/ops/clickhouse/explain` endpoint.
 */
export class OpsExplainClickHouseRepository extends OpsExplainRepository {
  static create({ resolver }: { resolver: OpsExplainClients }): OpsExplainClickHouseRepository {
    return new OpsExplainClickHouseRepository(resolver);
  }

  private constructor(private readonly resolver: OpsExplainClients) {
    super();
  }

  /**
   * The dedicated `langwatch_ops` readonly user when `CLICKHOUSE_OPS_URL`
   * is configured, else the injected shared client as a fallback.
   * Null when neither is configured on this instance.
   */
  findClient(): OpsExplainClientResolution | null {
    return this.resolver.findClient();
  }

  /**
   * Runs the (already server-wrapped) EXPLAIN query. `guardrails` are
   * ClickHouse settings sent only for the fallback client: the `langwatch_ops`
   * user's `readonly_safe` profile forbids client-side setting changes and
   * already enforces the same caps server-side.
   */
  async runExplain({
    client,
    wrappedQuery,
    guardrails,
  }: {
    client: OpsExplainQueryClient;
    wrappedQuery: string;
    guardrails?: ClickHouseSettings;
  }): Promise<unknown[]> {
    const result = await client.query({
      query: wrappedQuery,
      format: "JSONEachRow",
      ...(guardrails ? { clickhouse_settings: guardrails } : {}),
      unscoped: {
        reason:
          "Operator EXPLAIN: the fleet-wide query-plan endpoint runs as the read-only ops user and is deliberately outside the tenant-scoped access pattern.",
      },
    });
    return result.json();
  }
}

/** Process-owned lazy client for the dedicated read-only ops account. */
export class OpsClickHouseRuntime {
  static create(options: { url?: string; buildTime: boolean }): OpsClickHouseRuntime {
    return new OpsClickHouseRuntime(options.url, options.buildTime);
  }

  private client: ClickHouseClient | undefined;
  private closeOperation: Promise<void> | undefined;
  private closed = false;

  private constructor(
    private readonly url: string | undefined,
    private readonly buildTime: boolean,
  ) {}

  resolveClient(): ClickHouseClient | null {
    const configured = !this.closed && !this.buildTime && (this.url?.trim() ?? "") !== "";
    if (!configured || this.url === undefined) return null;
    if (this.client !== undefined) return this.client;

    const parsed = findOpsConnection(this.url);
    // No client-side `clickhouse_settings` here: the readonly profile forbids
    // session-setting changes; its server-side profile enforces the limits.
    this.client = createClient({
      url: parsed?.url ?? this.url,
      username: parsed?.username || undefined,
      password: parsed?.password || undefined,
      database: parsed?.database,
      max_open_connections: 5,
      keep_alive: { enabled: true, idle_socket_ttl: 1500 },
    });
    return this.client;
  }

  close(): Promise<void> {
    if (this.closeOperation !== undefined) return this.closeOperation;
    this.closed = true;
    const client = this.client;
    this.closeOperation = client === undefined ? Promise.resolve() : client.close();
    return this.closeOperation;
  }
}
