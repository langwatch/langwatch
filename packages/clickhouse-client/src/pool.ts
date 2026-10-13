/** Pool sizing derived from server budget; divide max_concurrent_queries by replica count. */

/** Default max_concurrent_queries per ClickHouse node. */
export const DEFAULT_SERVER_MAX_CONCURRENT_QUERIES = 300;

/** Default ClickHouse cluster nodes (1 = per-node budget, not per-cluster). */
export const DEFAULT_SERVER_NODES = 1;

/** Safety headroom for ad-hoc queries and ops tooling; absorbs per-user shares. */
export const FLEET_SAFETY_FACTOR = 0.7;

/** One client per process per server; factory was removed for lack of use. */
export const DEFAULT_CLIENTS_PER_PROCESS = 1;

/** Fallback pool size when fleet size is unknown; preserves historical value. */
export const FALLBACK_POOL_SIZE = 64;

/** A typo must not be able to melt the server or re-choke the client. */
export const MIN_POOL_SIZE = 1;
export const MAX_POOL_SIZE = 1024;

export interface PoolSizingInput {
  /** Operator override. Wins whenever it is a usable integer. */
  override?: number | undefined;
  /** Replicas of this deployment. Unknown or zero disables derivation. */
  replicas?: number | undefined;
  /** The server's `max_concurrent_queries`. Per NODE, not per cluster. */
  serverMaxConcurrentQueries?: number | undefined;
  /**
   * Nodes in the ClickHouse cluster the fleet spreads its statements across.
   * Unknown or not a positive integer means one, preserving the pre-cluster
   * sizing.
   */
  serverNodes?: number | undefined;
  /** Client instances this process constructs. */
  clientsPerProcess?: number | undefined;
}

export type PoolSizeSource = "override" | "derived" | "fallback";

export interface PoolSizingDecision {
  size: number;
  source: PoolSizeSource;
  /**
   * The strictest knowable ceiling: fleet budget when fleet size is stated,
   * else one process's share of a stated server cap. Present even for an
   * override so a conflict is reported, not discovered as rejected queries.
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
 * A fractional replica or client count can't exist, and treating it as one
 * (e.g. `clientsPerProcess: 0.5`) inflates the ceiling instead of shrinking
 * it — the opposite of the safety factor's job. Falls back to the default.
 */
function positiveIntegerOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * The unclamped ceiling: connections per pod the server's budget allows,
 * before the "never below one" floor applies. For detecting what that floor
 * would hide — a fleet so large even one connection per pod exceeds budget.
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
  const clients = positiveIntegerOr(input.clientsPerProcess, DEFAULT_CLIENTS_PER_PROCESS);
  const nodes = positiveIntegerOr(input.serverNodes, DEFAULT_SERVER_NODES);

  // serverMax is per node, so the cluster's budget is the per-node allowance
  // times the nodes the fleet can reach.
  return Math.floor((serverMax * nodes * FLEET_SAFETY_FACTOR) / (replicas * clients));
}

/** Single-process budget from stated server max; null when unspecified. */
function singleProcessBudget(input: PoolSizingInput): number | null {
  const serverMax = input.serverMaxConcurrentQueries;
  if (serverMax === undefined || !Number.isInteger(serverMax) || serverMax <= 0) {
    return null;
  }

  const clients = positiveIntegerOr(input.clientsPerProcess, DEFAULT_CLIENTS_PER_PROCESS);
  const nodes = positiveIntegerOr(input.serverNodes, DEFAULT_SERVER_NODES);

  return Math.floor((serverMax * nodes * FLEET_SAFETY_FACTOR) / clients);
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
export function resolvePoolSize(input: PoolSizingInput = {}): PoolSizingDecision {
  const raw = rawFleetPoolCeiling(input);
  const derivedCeiling =
    raw === null ? null : Math.min(MAX_POOL_SIZE, Math.max(MIN_POOL_SIZE, raw));
  // A raw ceiling below one means the fleet's budget cannot afford even a
  // single connection per pod - `deriveFleetPoolCeiling` floors that to 1 for
  // display, but a resolved size of 1 still exceeds the real budget, so the
  // floor must not also silence the warning.
  const infeasible = raw !== null && raw < MIN_POOL_SIZE;

  if (input.override !== undefined && isUsableInteger(input.override)) {
    // With the fleet size unknown, a stated server cap is still the
    // strictest knowable bound: one process's share of it. The override
    // wins either way - this only decides whether to report a conflict.
    const overrideCeiling = derivedCeiling !== null ? derivedCeiling : singleProcessBudget(input);
    return {
      size: input.override,
      source: "override",
      derivedCeiling: overrideCeiling,
      exceedsBudget: infeasible || (overrideCeiling !== null && input.override > overrideCeiling),
      rejectedOverride: undefined,
    };
  }

  const rejectedOverride =
    input.override !== undefined && !isUsableInteger(input.override) ? input.override : undefined;

  if (derivedCeiling !== null) {
    return {
      size: derivedCeiling,
      source: "derived",
      derivedCeiling,
      exceedsBudget: infeasible,
      rejectedOverride,
    };
  }

  // The fleet size is unknown, but a stated server cap still binds: one
  // process must not exceed the server alone. The clamp always reports the
  // budget as exceeded — siblings this process cannot count share the same
  // budget, and the warning is what tells the operator to state the fleet
  // size so the real derivation can take over.
  const budget = singleProcessBudget(input);
  if (budget !== null && budget < FALLBACK_POOL_SIZE) {
    const size = Math.max(MIN_POOL_SIZE, budget);
    return {
      size,
      source: "fallback",
      derivedCeiling: size,
      exceedsBudget: true,
      rejectedOverride,
    };
  }

  return {
    size: FALLBACK_POOL_SIZE,
    source: "fallback",
    derivedCeiling: budget,
    exceedsBudget: false,
    rejectedOverride,
  };
}

/**
 * Parse the sizing inputs out of an environment bag. Kept separate from
 * {@link resolvePoolSize} so the rules stay testable without touching
 * `process.env`, and so a non-Node host can supply the numbers another way.
 */
export function poolSizingFromEnv(env: Record<string, string | undefined>): PoolSizingInput {
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
    serverNodes: int("CLICKHOUSE_SERVER_NODES"),
    clientsPerProcess: int("CLICKHOUSE_CLIENTS_PER_PROCESS"),
  };
}
