import {
  type ClickHouseClient,
  createClickHouseClient,
  createPoolRegistry,
  type Metrics,
  sharedDatabaseRouter,
} from "@langwatch/clickhouse";

/**
 * The app's pool size for the shared client (`~/server/clickhouse/client.ts:65`,
 * `./clickhouse.factory.ts:26`), carried over rather than left to the new
 * client's own default of 10 — ADR-104 §1's "one construction path" rule
 * governs the client's behaviour, not the app's chosen pool size.
 */
const CH_MAX_OPEN_CONNECTIONS = 25;

export interface ClickHouseClientFactoryOptions {
  /** `CLICKHOUSE_URL` — the same env var the legacy client reads. */
  readonly url: string;
  readonly maxOpenConnections?: number;
  readonly requestTimeoutMs?: number;
  readonly observability?: { readonly metrics?: Metrics };
}

export interface AppClickHouseClient {
  /** Resolves a tenant to the client that serves it (ADR-104 §4). */
  resolveClient(tenantId: string): ClickHouseClient;
  close(): Promise<void>;
}

/**
 * `CLICKHOUSE_URL` carries the database as its path (`http://host:8123/db`,
 * `.env.example:112`). `sharedDatabaseRouter`'s `TenantTarget` wants the two
 * apart, so the path is peeled off here rather than asking every caller to
 * parse the app's own env var shape.
 */
function parseTarget(rawUrl: string): { url: string; database: string } {
  const parsed = new URL(rawUrl);
  const database =
    decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "default";
  parsed.pathname = "/";
  return { url: parsed.toString(), database };
}

/**
 * The one construction path for the new ClickHouse client (ADR-104, ADR-102
 * decision 6). Routes through `sharedDatabaseRouter` — the one shared
 * database every tenant uses today — via a pool registry, so switching a
 * deployment onto `mappedTenantRouter` for per-tenant databases is a config
 * change here, not a rewrite of every caller holding a `resolveClient`.
 */
export function createAppClickHouseClient(
  opts: ClickHouseClientFactoryOptions,
): AppClickHouseClient {
  const target = parseTarget(opts.url);
  const router = sharedDatabaseRouter(target);
  const registry = createPoolRegistry<ClickHouseClient>({
    create: (t) =>
      createClickHouseClient({
        url: t.url,
        database: t.database,
        maxOpenConnections: opts.maxOpenConnections ?? CH_MAX_OPEN_CONNECTIONS,
        requestTimeoutMs: opts.requestTimeoutMs,
        observability: opts.observability,
      }),
    destroy: (client) => client.close(),
  });

  return {
    resolveClient: (tenantId) => registry.acquire(router.resolve(tenantId)),
    close: () => registry.closeAll(),
  };
}
