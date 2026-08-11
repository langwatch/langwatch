/**
 * Configuration resolution for the Redis client.
 *
 * Everything here is a pure function over a caller-supplied environment. The
 * package never reads `process.env` itself: the composition root already
 * validates env once, and a package that reaches for ambient state is exactly
 * what made the old module-level connection impossible to load in a build, a
 * test, or a browser bundle. See ADR-090.
 */

/** The raw, unparsed environment values this package understands. */
export interface RedisEnvironment {
  /** `REDIS_URL` — a `redis://` or `rediss://` connection string. */
  url?: string | undefined;
  /** `REDIS_CLUSTER_ENDPOINTS` — comma-separated `host:port` pairs. */
  clusterEndpoints?: string | undefined;
  /** `REDIS_DB_INDEX` — the dev worktree-isolation database index, 0-15. */
  dbIndex?: string | number | undefined;
  /** `SKIP_REDIS` — when true, the caller wants no Redis at all. */
  skip?: boolean | undefined;
}

export interface RedisClusterEndpoint {
  host: string;
  port: number;
}

/** TLS is off, on, or on-without-verification, decided by the URL. */
export type RedisTlsSetting = undefined | Record<string, never> | { rejectUnauthorized: false };

export interface RedisStandaloneConfig {
  configured: true;
  mode: "standalone";
  url: string;
  /** Applied to the connection; see {@link parseRedisDbIndex}. */
  db: number;
  tls: RedisTlsSetting;
  warnings: string[];
}

export interface RedisClusterConfig {
  configured: true;
  mode: "cluster";
  endpoints: RedisClusterEndpoint[];
  /** Always 0 — Redis Cluster supports only database 0. */
  db: 0;
  warnings: string[];
}

export interface RedisUnconfigured {
  configured: false;
  /** `disabled` means the caller opted out; `unconfigured` means no URL was given. */
  reason: "disabled" | "unconfigured";
  warnings: string[];
}

export type RedisConfigResolution =
  | RedisStandaloneConfig
  | RedisClusterConfig
  | RedisUnconfigured;

const DEFAULT_REDIS_PORT = 6379;
const VALID_DB_INDEX = /^(?:[0-9]|1[0-5])$/;

/**
 * Parses a database index into a validated 0-15 integer.
 *
 * Returns 0 for anything unset, malformed, or out of range — this is a dev
 * affordance (`pnpm dev` at PORT=5570 lands on DB 1, keeping worktrees off each
 * other's GroupQueue streams), not a hard config, so it never throws.
 */
export function parseRedisDbIndex(raw: string | number | undefined): number {
  if (raw === void 0 || raw === "") return 0;
  const text = String(raw);
  if (!VALID_DB_INDEX.test(text)) return 0;
  return Number(text);
}

/**
 * Splits a comma-separated endpoint list into hosts and ports. Entries may omit
 * the scheme (`host:port`) or carry one (`redis://host:port`); a missing port
 * falls back to the standard Redis port.
 */
export function parseClusterEndpoints(
  endpointsStr: string,
): RedisClusterEndpoint[] {
  return endpointsStr
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((raw) => {
      const url = raw.includes("://")
        ? new URL(raw)
        : new URL(`redis://${raw}`);
      return {
        host: url.hostname,
        port: Number(url.port || DEFAULT_REDIS_PORT),
      };
    });
}

function resolveTls(url: string): RedisTlsSetting {
  if (url.includes("tls.rejectUnauthorized=false")) {
    return { rejectUnauthorized: false };
  }
  if (url.includes("rediss://")) return {};
  return void 0;
}

/**
 * Decides how — and whether — to connect, from the supplied environment.
 *
 * Cluster endpoints win over a plain URL when both are set. A clustered
 * deployment normally sets only `REDIS_CLUSTER_ENDPOINTS`, so "both" is the
 * ambiguous case rather than the usual one — and there the endpoint list is the
 * more specific statement of intent, while the leftover URL may well name a
 * different server.
 */
export function resolveRedisConfig(
  env: RedisEnvironment,
): RedisConfigResolution {
  const warnings: string[] = [];

  if (env.skip) {
    return { configured: false, reason: "disabled", warnings };
  }
  if (!env.url && !env.clusterEndpoints) {
    return { configured: false, reason: "unconfigured", warnings };
  }

  const dbIndex = parseRedisDbIndex(env.dbIndex);

  if (env.clusterEndpoints) {
    if (dbIndex !== 0) {
      warnings.push(
        "REDIS_DB_INDEX is set but REDIS_CLUSTER_ENDPOINTS is active — cluster mode only supports database 0, ignoring",
      );
    }
    return {
      configured: true,
      mode: "cluster",
      endpoints: parseClusterEndpoints(env.clusterEndpoints),
      db: 0,
      warnings,
    };
  }

  const url = env.url ?? "";
  return {
    configured: true,
    mode: "standalone",
    url,
    db: dbIndex,
    tls: resolveTls(url),
    warnings,
  };
}

/**
 * Whether this environment wants Redis at all.
 *
 * For callers that must decide their shape before a connection exists —
 * better-auth picks its session-storage strategy at module scope — this answers
 * the configuration question without needing a live client.
 */
export function isRedisConfigured(env: RedisEnvironment): boolean {
  return resolveRedisConfig(env).configured;
}
