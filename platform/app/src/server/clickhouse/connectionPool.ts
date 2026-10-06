import {
  poolSizingFromEnv,
  resolvePoolSize,
} from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";
import { DEFAULT_LANE_RESERVE_SHARE } from "./statementLimit";

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
 * states the server's cap (haven exports it next to `CLICKHOUSE_URL`, from the
 * value it renders into the shared container's config, so a 32-query dev
 * server never meets a 64-connection pool; a deployment that manages its own
 * server has to state the cap itself).
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

/**
 * Resolve the fraction of this process's statement slots each kind of work
 * keeps in reserve for the other (see `./statementLimit.ts`).
 *
 * Read from `CLICKHOUSE_STATEMENT_LANE_RESERVE_SHARE`. The valid range is the
 * half-open interval (0, 0.5]: a reserve of nothing reintroduces the starvation
 * the lanes exist to prevent, and a reserve above half the budget would hold
 * back more for one kind than that kind may itself use. A value outside it is a
 * typo, so it warns and falls back rather than silently misconfiguring the
 * bound. A blank or whitespace value is "unset", not a mistake, so it takes the
 * default quietly.
 */
export function getClickHouseStatementLaneReserveShare(): number {
  const raw = process.env.CLICKHOUSE_STATEMENT_LANE_RESERVE_SHARE;
  if (raw === undefined || raw.trim() === "") return DEFAULT_LANE_RESERVE_SHARE;

  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 0.5) return parsed;

  logger.warn(
    { raw, using: DEFAULT_LANE_RESERVE_SHARE },
    "Invalid CLICKHOUSE_STATEMENT_LANE_RESERVE_SHARE; using default",
  );
  return DEFAULT_LANE_RESERVE_SHARE;
}
