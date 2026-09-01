import {
  poolSizingFromEnv,
  resolvePoolSize,
} from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:clickhouse:connection-pool");

/**
 * Resolve the ClickHouse client pool size for this process.
 *
 * The rules live in `@langwatch/clickhouse-client` so every construction site
 * agrees on them; this function only supplies the environment and reports what
 * was decided.
 *
 * A pool is per client INSTANCE, so the server's budget has to cover every pool
 * on every pod. Set `CLICKHOUSE_CLIENT_REPLICAS` from the downward API and the
 * size is derived from that budget. Without it a pod cannot know how many
 * siblings it has, so the historical fixed default stands — clamped to what
 * one process alone may claim when `CLICKHOUSE_SERVER_MAX_CONCURRENT_QUERIES`
 * states the server's cap (haven exports it; a 32-query dev server must not
 * meet a 64-connection pool).
 *
 * This is the socket ceiling, not the working limit. A process has one
 * construction site against a given server (`./managedClient.ts`), and what
 * actually bounds the statements it runs is the limiter in `./statementLimit.ts`,
 * sized from this number so the two agree.
 */
export function getClickHouseMaxOpenConnections(): number {
  const decision = resolvePoolSize(poolSizingFromEnv(process.env));

  if (decision.rejectedOverride !== undefined) {
    logger.warn(
      // The raw string, not the parsed value: a non-numeric setting parses to
      // NaN, which serialises as null and tells the reader nothing.
      {
        raw: process.env.CLICKHOUSE_MAX_OPEN_CONNECTIONS,
        using: decision.size,
        source: decision.source,
      },
      "Invalid CLICKHOUSE_MAX_OPEN_CONNECTIONS; using resolved default",
    );
  }

  if (decision.exceedsBudget) {
    logger.warn(
      {
        configured: decision.size,
        derivedCeiling: decision.derivedCeiling,
        source: decision.source,
      },
      decision.source === "fallback"
        ? "ClickHouse pool clamped to the server's stated budget; set CLICKHOUSE_CLIENT_REPLICAS so the size can be derived for the whole fleet"
        : "CLICKHOUSE_MAX_OPEN_CONNECTIONS lets this fleet exceed the server's concurrent-query budget",
    );
  }

  return decision.size;
}
