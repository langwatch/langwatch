import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:clickhouse:connection-pool");

/**
 * Default HTTP connection pool size per ClickHouse client.
 *
 * Sizing note: the pool bounds this process's concurrent in-flight queries.
 * The historical value of 25 predated the event-sourcing dispatch concurrency
 * (GLOBAL_QUEUE_CONCURRENCY=256 in production) and became the system
 * bottleneck: with 4 worker pods the server showed exactly 4 x 25 = 100 open
 * connections pinned at cap while sitting at a third of its
 * `max_concurrent_queries` (300) and answering in ~55ms — workers measured
 * multi-second latency for those same queries, all of it client-side queueing
 * for a pooled socket.
 *
 * 64 keeps a 4-pod worker fleet (256 potential concurrent queries) within the
 * server's 300-query ceiling. Deployments with more replicas or a different
 * server budget tune CLICKHOUSE_MAX_OPEN_CONNECTIONS instead of editing code.
 */
const DEFAULT_MAX_OPEN_CONNECTIONS = 64;

/** Hard bounds so a typo'd env value cannot melt the server or re-choke the client. */
const MIN_POOL = 1;
const MAX_POOL = 1024;

/**
 * Resolve the ClickHouse client pool size from
 * `CLICKHOUSE_MAX_OPEN_CONNECTIONS`, falling back to the default when unset
 * or invalid. Shared by every ClickHouse client construction site so the
 * knob stays one env var.
 */
export function getClickHouseMaxOpenConnections(): number {
  const raw = process.env.CLICKHOUSE_MAX_OPEN_CONNECTIONS;
  if (raw === undefined || raw === "") return DEFAULT_MAX_OPEN_CONNECTIONS;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_POOL || parsed > MAX_POOL) {
    logger.warn(
      { raw, default: DEFAULT_MAX_OPEN_CONNECTIONS },
      "Invalid CLICKHOUSE_MAX_OPEN_CONNECTIONS; using default",
    );
    return DEFAULT_MAX_OPEN_CONNECTIONS;
  }
  return parsed;
}
