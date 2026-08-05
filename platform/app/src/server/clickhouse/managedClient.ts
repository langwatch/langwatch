import { createClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import {
  createResilientClickHouseClient,
  type ResilientClickHouseClient,
} from "~/server/app-layer/clients/clickhouse/resilient-client";
import { ClickHouseLogger } from "./clickhouseLogger";
import { getClickHouseMaxOpenConnections } from "./connectionPool";
import { wrapWithDefaultSettings } from "./safeClickhouseClient";
import { withStatementLimit } from "./statementLimit";

const logger = createLogger("langwatch:clickhouse:managed-client");

/**
 * The only place in the platform that builds a ClickHouse client.
 *
 * Every policy the platform applies to a statement is assembled here, in one
 * order, so that adding one applies it everywhere and no caller can be holding
 * a client that missed it. The shared instance and a customer's private
 * instance differ only in their URL.
 *
 * Outermost first, which is the order a statement passes through:
 *
 *   default settings  memory caps and spill-to-disk, merged under any the
 *                     caller supplied
 *   statement limit   bounded in-flight statements, a finite wait queue, and
 *                     the metrics that make both visible
 *   resilience        retry on transient read failures, error translation,
 *                     cold-scan and outcome logging, in-band exception guard
 *   driver            the connection pool
 *
 * The limit sits outside resilience deliberately: a slot is held for the whole
 * statement rather than taken per attempt, so a retry keeps its place instead
 * of rejoining the queue behind newer work.
 */
export function createManagedClickHouseClient({
  url,
  instance,
}: {
  /** Connection URL. Passed through as a string if it will not parse. */
  url: string;
  /**
   * Label for this client's metrics: "shared", or an organization id for a
   * private instance. Not the URL - that carries credentials.
   */
  instance: string;
}): ResilientClickHouseClient {
  let parsedUrl: URL | string = url;
  try {
    parsedUrl = new URL(url);
  } catch {
    // Deliberately without the error. A ClickHouse URL carries credentials,
    // and Node attaches the offending string to an ERR_INVALID_URL as `input`
    // - which a structured logger serialises straight into the log line. The
    // instance label says which client failed, and that is the whole of what
    // an operator needs here.
    logger.warn(
      { instance },
      "ClickHouse URL was not a valid URL, it will still be set, but may not work as expected.",
    );
  }

  const maxOpenConnections = getClickHouseMaxOpenConnections();

  const raw = createClient({
    url: parsedUrl,
    clickhouse_settings: {
      date_time_input_format: "best_effort",
    },
    max_open_connections: maxOpenConnections,
    keep_alive: {
      enabled: true,
      idle_socket_ttl: 1500,
    },
    log: { LoggerClass: ClickHouseLogger },
  });

  return wrapWithDefaultSettings(
    withStatementLimit({
      client: createResilientClickHouseClient({ client: raw }),
      // The pool size, so this bounds where the pool used to and capacity is
      // unchanged. The difference is that the queue in front of it is finite,
      // timed and counted.
      maxConcurrent: maxOpenConnections,
      instance,
    }),
  );
}
