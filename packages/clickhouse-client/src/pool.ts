/**
 * Connection-pool sizing.
 *
 * A pool is per client INSTANCE, and a process that constructs two clients
 * opens two pools. The server's budget has to cover every pool on every pod, so
 * the only safe way to pick a size is from the server's own
 * `max_concurrent_queries` divided by the fleet - never a fixed number chosen
 * against an assumed replica count.
 *
 * On 2026-07-31 a fixed default of 64, reasoned about as "4 pods x 1 client",
 * met a fleet of 10 worker pods and 3 app pods each holding 2 clients. The
 * server rejected ~37k queries with TOO_MANY_SIMULTANEOUS_QUERIES, and the
 * retry path drove every rejection straight back into the same wall.
 *
 * Nothing here reads `process.env`: the caller passes the numbers in, so the
 * rules are the same in every process and testable without mocking the
 * environment.
 */

/** ClickHouse's own `max_concurrent_queries` when the deployment says nothing. */
export const DEFAULT_SERVER_MAX_CONCURRENT_QUERIES = 300;

/**
 * Headroom left for everything the derivation cannot see: ad-hoc queries, ops
 * tooling, migrations, and the burst a retry storm adds on top of steady state.
 */
export const FLEET_SAFETY_FACTOR = 0.7;

/** Both the raw client and the app-layer factory build one, each with a pool. */
export const DEFAULT_CLIENTS_PER_PROCESS = 2;

/**
 * Used only when the fleet size is unknown, which is the case for any process
 * that has not been told its replica count. Preserves the historical value so
 * adopting this package changes nothing until the deployment opts in.
 */
export const FALLBACK_POOL_SIZE = 64;

/** A typo must not be able to melt the server or re-choke the client. */
export const MIN_POOL_SIZE = 1;
export const MAX_POOL_SIZE = 1024;

export interface PoolSizingInput {
  /** Operator override. Wins whenever it is a usable integer. */
  override?: number | undefined;
  /** Replicas of this deployment. Unknown or zero disables derivation. */
  replicas?: number | undefined;
  /** The server's `max_concurrent_queries`. */
  serverMaxConcurrentQueries?: number | undefined;
  /** Client instances this process constructs. */
  clientsPerProcess?: number | undefined;
}

export type PoolSizeSource = "override" | "derived" | "fallback";

export interface PoolSizingDecision {
  size: number;
  source: PoolSizeSource;
  /**
   * What the fleet budget would have allowed, when it is knowable. Present
   * even for an override so the caller can report a conflict rather than
   * discovering it as rejected queries.
   */
  derivedCeiling: number | null;
  /**
   * Set when the resolved size lets the fleet exceed the server's budget. The
   * caller decides whether that is a warning or a refusal to boot; this module
   * only states the fact.
   */
  exceedsBudget: boolean;
  /** Set when an override was supplied but was not a usable integer. */
  rejectedOverride: number | undefined;
}

function isUsableInteger(value: number | undefined): value is number {
  return (
    value !== undefined &&
    Number.isInteger(value) &&
    value >= MIN_POOL_SIZE &&
    value <= MAX_POOL_SIZE
  );
}

/**
 * A fractional replica or client count cannot exist, and treating it as one
 * anyway (e.g. `clientsPerProcess: 0.5`) inflates the derived ceiling instead
 * of shrinking it - the opposite of what the safety factor is for. Anything
 * that is not a positive integer falls back to the default.
 */
function positiveIntegerOr(
  value: number | undefined,
  fallback: number,
): number {
  return value !== undefined && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

/**
 * The unclamped ceiling: how many connections per pod the server's budget
 * actually allows, before the "never below one usable connection" floor is
 * applied. Callers that only need the reportable ceiling want
 * {@link deriveFleetPoolCeiling}; this is for detecting the case the floor
 * would otherwise hide - a fleet so large that even a single connection per
 * pod exceeds the budget.
 */
function rawFleetPoolCeiling(input: PoolSizingInput): number | null {
  const replicas = input.replicas;
  if (replicas === undefined || !Number.isInteger(replicas) || replicas <= 0) {
    return null;
  }

  const serverMax = positiveIntegerOr(
    input.serverMaxConcurrentQueries,
    DEFAULT_SERVER_MAX_CONCURRENT_QUERIES,
  );
  const clients = positiveIntegerOr(
    input.clientsPerProcess,
    DEFAULT_CLIENTS_PER_PROCESS,
  );

  return Math.floor((serverMax * FLEET_SAFETY_FACTOR) / (replicas * clients));
}

/**
 * The largest per-client pool that keeps every pool on every pod inside the
 * server's budget. Null when the fleet size is unknown, because a pod cannot
 * infer how many siblings it has.
 */
export function deriveFleetPoolCeiling(input: PoolSizingInput): number | null {
  const raw = rawFleetPoolCeiling(input);
  if (raw === null) return null;
  return Math.min(MAX_POOL_SIZE, Math.max(MIN_POOL_SIZE, raw));
}

/**
 * Resolve the pool size and say where it came from. Returns a decision rather
 * than a number so the caller owns the reporting, and so a conflict between an
 * override and the fleet budget is visible instead of silent.
 */
export function resolvePoolSize(
  input: PoolSizingInput = {},
): PoolSizingDecision {
  const raw = rawFleetPoolCeiling(input);
  const derivedCeiling =
    raw === null ? null : Math.min(MAX_POOL_SIZE, Math.max(MIN_POOL_SIZE, raw));
  // A raw ceiling below one means the fleet's budget cannot afford even a
  // single connection per pod - `deriveFleetPoolCeiling` floors that to 1 for
  // display, but a resolved size of 1 still exceeds the real budget, so the
  // floor must not also silence the warning.
  const infeasible = raw !== null && raw < MIN_POOL_SIZE;

  if (input.override !== undefined && isUsableInteger(input.override)) {
    return {
      size: input.override,
      source: "override",
      derivedCeiling,
      exceedsBudget:
        infeasible ||
        (derivedCeiling !== null && input.override > derivedCeiling),
      rejectedOverride: undefined,
    };
  }

  const rejectedOverride =
    input.override !== undefined && !isUsableInteger(input.override)
      ? input.override
      : undefined;

  if (derivedCeiling !== null) {
    return {
      size: derivedCeiling,
      source: "derived",
      derivedCeiling,
      exceedsBudget: infeasible,
      rejectedOverride,
    };
  }

  return {
    size: FALLBACK_POOL_SIZE,
    source: "fallback",
    derivedCeiling: null,
    exceedsBudget: false,
    rejectedOverride,
  };
}

/**
 * Parse the sizing inputs out of an environment bag. Kept separate from
 * {@link resolvePoolSize} so the rules stay testable without touching
 * `process.env`, and so a non-Node host can supply the numbers another way.
 */
export function poolSizingFromEnv(
  env: Record<string, string | undefined>,
): PoolSizingInput {
  const int = (name: string): number | undefined => {
    const raw = env[name];
    if (raw === undefined || raw === "") return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };

  return {
    override: int("CLICKHOUSE_MAX_OPEN_CONNECTIONS"),
    replicas: int("CLICKHOUSE_CLIENT_REPLICAS"),
    serverMaxConcurrentQueries: int("CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES"),
    clientsPerProcess: int("CLICKHOUSE_CLIENTS_PER_PROCESS"),
  };
}
