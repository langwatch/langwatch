import {
  type ClickHouseClient,
  createClickHouseClient,
  createPoolRegistry,
  type Metrics,
  mappedTenantRouter,
  sharedDatabaseRouter,
  type TenantTarget,
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
  /**
   * Organisations pinned to their own ClickHouse endpoint, parsed from the
   * `CLICKHOUSE_URL__<label>__<orgId>` env vars (see
   * `./clickhouse/private-endpoints.ts`). Keyed by organisation id, because
   * that is the grain the deployment sells: a private instance is bought by an
   * organisation and shared by every project inside it.
   */
  readonly privateUrlsByOrganizationId?: ReadonlyMap<string, string>;
  readonly maxOpenConnections?: number;
  readonly requestTimeoutMs?: number;
  readonly observability?: { readonly metrics?: Metrics };
}

export interface AppClickHouseClient {
  /**
   * Resolves a routing key to the client that serves it (ADR-104 §4).
   *
   * The key is an **organisation id** whenever one is known, because that is
   * what private-endpoint routing is keyed on. Callers with no organisation
   * (the event-sourcing log, which is deployment-wide) pass any stable string:
   * an unrecognised key resolves to the shared endpoint, which is where those
   * callers belong.
   */
  resolveClient(routingKey: string): ClickHouseClient;
  /**
   * Every distinct endpoint this deployment can reach — the shared one plus
   * each private one, deduplicated. Ops paths that must act on all of them
   * (migrations, TTL reconciliation, drift checks) enumerate these.
   */
  knownTargets(): readonly TenantTarget[];
  /** The client for one target, for the ops paths that iterate targets. */
  clientForTarget(target: TenantTarget): ClickHouseClient;
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
 * decision 6).
 *
 * A deployment with no private endpoints gets `sharedDatabaseRouter` — one
 * database, tenants separated by the `TenantId` column. A deployment that
 * declares any gets `mappedTenantRouter`, whose resolution is total: an
 * organisation absent from the map lands on the shared endpoint, so a brand
 * new organisation is never blocked waiting to be added. That is the same
 * behaviour the driver-based resolver had, expressed as routing rather than as
 * a differently-configured client object — which is what closes the divergence
 * where a private endpoint quietly ran on a pool of 10 and a 2500 ms keep-alive
 * while the shared one ran on 25 and 1500 ms.
 */
export function createAppClickHouseClient(
  opts: ClickHouseClientFactoryOptions,
): AppClickHouseClient {
  const fallback = parseTarget(opts.url);
  const overrides = new Map<string, TenantTarget>(
    [...(opts.privateUrlsByOrganizationId ?? new Map())].map(
      ([organizationId, url]) => [organizationId, parseTarget(url)],
    ),
  );
  const router =
    overrides.size === 0
      ? sharedDatabaseRouter(fallback)
      : mappedTenantRouter({ fallback, overrides });

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
    resolveClient: (routingKey) => registry.acquire(router.resolve(routingKey)),
    knownTargets: () => router.knownTargets(),
    clientForTarget: (target) => registry.acquire(target),
    close: () => registry.closeAll(),
  };
}
