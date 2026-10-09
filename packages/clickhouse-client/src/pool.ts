/**
 * Connection-pool sizing.
 *
 * A pool is per client INSTANCE, so the server's budget has to cover every pool
 * on every pod, and the only safe way to pick a size is from the server's own
 * `max_concurrent_queries` divided by the fleet - never a fixed number chosen
 * against an assumed replica count.
 *
 * On 2026-07-31 a fixed default of 64, reasoned about as "4 pods x 1 client",
 * met a fleet of 10 worker pods and 3 app pods each holding 2 clients. The
 * server rejected ~37k queries with TOO_MANY_SIMULTANEOUS_QUERIES, and the
 * retry path drove every rejection straight back into the same wall.
 *
 * Read the sizing here for what it is: a ceiling on sockets, and a backstop
 * rather than the working limit. Production says so plainly - ClickHouse holds
 * one connection per statement actually in flight and closes idle ones within
 * `idle_socket_ttl`, so its connection count tracks its query count 1:1 and
 * never approaches the pool cap. What a process needs bounded is the number of
 * statements it will TRY to run, which is set by whatever queue feeds it, not
 * by this number. That bound lives in `./rateLimit`, and it is the one that
 * should bind first; this only stops a runaway from opening sockets without
 * limit.
 *
 * Nothing here reads `process.env`: the caller passes the numbers in, so the
 * rules are the same in every process and testable without mocking the
 * environment.
 */

/**
 * ClickHouse's own `max_concurrent_queries` when the deployment says nothing.
 *
 * This is a PER-NODE allowance — it is what one ClickHouse server admits, not
 * what the cluster admits. Multiply by {@link PoolSizingInput.serverNodes} for
 * the fleet's real budget.
 */
export const DEFAULT_SERVER_MAX_CONCURRENT_QUERIES = 300;

/**
 * Nodes in the ClickHouse cluster when the deployment says nothing.
 *
 * One, because that is what the derivation assumed before it could be told
 * otherwise: a deployment that says nothing keeps the sizing it already had.
 *
 * It matters because `max_concurrent_queries` is enforced per server while a
 * fleet's statements spread across every replica. Reading the per-node number
 * as the whole cluster's budget understates the real capacity by the node
 * count, and the platform then throttles itself — queueing for seconds and
 * shedding statements — against a cluster that is mostly idle and rejecting
 * nothing. Measured on prod 2026-08-18: three nodes at 74/60/70 concurrent
 * queries against 300 each, zero `TOO_MANY_SIMULTANEOUS_QUERIES`, while the
 * client-side limiter shed ~1,057 statements an hour.
 */
export const DEFAULT_SERVER_NODES = 1;

/**
 * Headroom left for everything the derivation cannot see: ad-hoc queries, ops
 * tooling, migrations, and the burst a retry storm adds on top of steady state.
 *
 * It also absorbs the per-user shares carved out of the server budget — on prod
 * the platform user holds 270 of the 300, so 0.7 stays inside the platform's
 * own allowance without needing a separate knob for it.
 */
export const FLEET_SAFETY_FACTOR = 0.7;

/**
 * One, because a process now has exactly one construction site for a client
 * against a given server (`~/server/clickhouse/managedClient.ts`).
 *
 * It was 2 while the app-layer factory existed alongside the raw client. That
 * factory turned out to have no callers at all, so the 2 was halving every
 * derived ceiling to pay for a pool nobody opened. Both are gone; a per-tenant
 * private instance still gets its own client, but that is a different server
 * with its own budget, not a second pool against this one.
 */
export const DEFAULT_CLIENTS_PER_PROCESS = 1;

/**
 * Used only when the fleet size is unknown, which is the case for any process
 * that has not been told its replica count. Preserves the historical value so
 * adopting this package changes nothing until the deployment opts in.
 *
 * A MAXIMUM, not a floor: when the deployment states the server's own
 * `max_concurrent_queries` without a replica count, the fallback still clamps
 * to what one process alone may safely claim of that budget — a single pod
 * holding 64 sockets against a server that admits 32 queries needs no sibling
 * pods to melt it.
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
   * The strictest knowable ceiling: the fleet budget when the fleet size is
   * stated, otherwise one process's share of a stated server cap. Present
   * even for an override so the caller can report a conflict rather than
   * discovering it as rejected queries. Null when nothing about the server's
   * capacity was stated at all.
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
  const nodes = positiveIntegerOr(input.serverNodes, DEFAULT_SERVER_NODES);

  // serverMax is per node, so the cluster's budget is the per-node allowance
  // times the nodes the fleet can reach.
  return Math.floor(
    (serverMax * nodes * FLEET_SAFETY_FACTOR) / (replicas * clients),
  );
}

/**
 * What one process alone may claim of a server budget the deployment has
 * actually stated. Null when the deployment said nothing about the cap — the
 * built-in default must not masquerade as knowledge, or every deployment
 * would suddenly "know" a budget nobody measured.
 *
 * Used when the fleet size is unknown - to clamp the fallback, and to judge
 * an override: it cannot keep the whole fleet inside the budget (that needs
 * the replica count), but it does catch a single process set up to exceed
 * the server on its own.
 */
function singleProcessBudget(input: PoolSizingInput): number | null {
  const serverMax = input.serverMaxConcurrentQueries;
  if (
    serverMax === undefined ||
    !Number.isInteger(serverMax) ||
    serverMax <= 0
  ) {
    return null;
  }

  const clients = positiveIntegerOr(
    input.clientsPerProcess,
    DEFAULT_CLIENTS_PER_PROCESS,
  );
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
    // With the fleet size unknown, a stated server cap is still the
    // strictest knowable bound: one process's share of it. The override
    // wins either way - this only decides whether to report a conflict.
    const overrideCeiling =
      derivedCeiling !== null ? derivedCeiling : singleProcessBudget(input);
    return {
      size: input.override,
      source: "override",
      derivedCeiling: overrideCeiling,
      exceedsBudget:
        infeasible ||
        (overrideCeiling !== null && input.override > overrideCeiling),
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
    serverNodes: int("CLICKHOUSE_SERVER_NODES"),
    clientsPerProcess: int("CLICKHOUSE_CLIENTS_PER_PROCESS"),
  };
}
