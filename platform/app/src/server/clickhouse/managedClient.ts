import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { VendorClientResilience } from "@langwatch/clickhouse-client";
import { CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { detectColdScan } from "~/server/app-layer/clients/clickhouse/cold-scan-detector";
import { translateClickHouseQueryError } from "~/server/app-layer/clients/clickhouse/translate-query-error";
import { queryWindowed } from "~/server/app-layer/clients/clickhouse/windowed-read";
import { ClickHouseLogger } from "./clickhouseLogger";
import { getClickHouseMaxOpenConnections } from "./connectionPool";
import {
  incrementClickHouseQueryCount,
  observeClickHouseQueryDuration,
} from "./metrics";
import { wrapWithDefaultSettings } from "./safeClickhouseClient";
import { withStatementLimit } from "./statementLimit";

const logger = createLogger("langwatch:clickhouse:managed-client");

/**
 * A resilient ClickHouse client: a {@link ClickHouseClient} whose `query`/`insert`
 * carry retry + error translation, plus {@link queryWindowed} for the
 * partition-pruning-window-with-fallback read pattern. Repositories resolve one
 * of these and call `queryWindowed` without a cast.
 */
export type ResilientClickHouseClient = ClickHouseClient & {
  queryWindowed: typeof queryWindowed;
};

/**
 * The metrics label for the shared instance. A constant because it is written
 * when the client is built and read when it is closed, and the two must agree
 * or the limiter's probe outlives it.
 */
export const SHARED_INSTANCE = "shared";

/**
 * How long one statement may spend on the wire before the driver gives up.
 *
 * 30s is the value the driver already applied as its own default, so stating it
 * changes no behaviour today — that is the point. It was the largest single
 * term in an observed 46-second failure and nothing in this repo had chosen it,
 * which also meant a driver upgrade could move it silently.
 *
 * It is deliberately longer than the queue wait in `./statementLimit.ts`: a
 * statement that has reached the wire is doing work, while one still queued has
 * not started, and the one worth abandoning first is the one that has spent
 * nothing.
 */
export const CLICKHOUSE_REQUEST_TIMEOUT_MS = 30_000;

/**
 * The resilience policy in `@langwatch/clickhouse-client`, given everything the
 * package leaves to its host: where metrics and log lines go, how a raised read
 * error becomes a typed `HandledError` with remediation, which queries count as
 * cold scans (the table list is this schema's knowledge, pinned to the
 * migrations by `cold-scan-detector.coverage.unit.test.ts`), and the
 * transient-message list — still owned by
 * `event-sourcing/services/errorHandling.ts`, which keeps this layer and the
 * outer group-queue classifier reading the same list forever.
 */
export function createResilientClickHouseClient({
  client,
  cluster = "shared",
  maxRetries = 3,
  baseDelayMs = 500,
  maxDelayMs = 10_000,
}: {
  client: ClickHouseClient;
  /**
   * Which ClickHouse this client talks to, stamped on every failure line.
   * Defaults to "shared" because that is what a caller naming nothing has.
   */
  cluster?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}): ResilientClickHouseClient {
  const resilience = new VendorClientResilience({
    cluster,
    maxRetries,
    baseDelayMs,
    maxDelayMs,
    transientMessageFragments: CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS,
    // The package's ports take named arguments; these platform functions are
    // older and positional, and both have callers of their own. Adapting here
    // is this function's job — it is the seam between what the platform has and
    // what the package asks for.
    metrics: {
      observeDuration: ({ queryType, table, durationSeconds }) =>
        observeClickHouseQueryDuration(queryType, table, durationSeconds),
      incrementCount: ({ queryType, outcome }) =>
        incrementClickHouseQueryCount(queryType, outcome),
    },
    noticeLogger: createLogger("langwatch:clickhouse:resilient"),
    outcomeLogger: createLogger("langwatch:clickhouse:query"),
    translateQueryError: ({ error, durationMs }) =>
      translateClickHouseQueryError(error, durationMs),
    detectColdScan,
  });

  const wrapper = resilience.wrap(client) as ResilientClickHouseClient;
  // Orchestration only — the caller's `run` closure issues each attempt through
  // this same wrapper's `query`, so retry + error translation apply per windowed
  // attempt. Assigned by reference to preserve the generic signature.
  wrapper.queryWindowed = queryWindowed;
  return wrapper;
}

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
  cluster = instance,
}: {
  /** Connection URL. Passed through as a string if it will not parse. */
  url: string;
  /**
   * Label for this client's metrics: "shared", or an organization id for a
   * private instance. Not the URL - that carries credentials.
   */
  instance: string;
  /**
   * Human name of the cluster this client talks to, for the LOGS: "shared", or
   * the label from `CLICKHOUSE_URL__<label>__<orgId>`.
   *
   * Deliberately separate from `instance` rather than replacing it. `instance`
   * is a metrics label, and repointing it would move every existing series and
   * break the dashboards built on them; this only has to be readable by a
   * person looking at one error line. Defaults to `instance` so a caller with
   * no better name still gets a populated field rather than an absent one.
   */
  cluster?: string;
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
    // Stated rather than inherited. It was previously the driver's own default,
    // which meant the bound on a statement was a number nobody in this repo had
    // chosen and a driver upgrade could move without anyone noticing. Naming it
    // also makes the two waits add up: what a caller actually observed on a
    // stuck insert was this, plus however long it had queued in
    // `./statementLimit.ts` — which is why that wait is bounded too.
    request_timeout: CLICKHOUSE_REQUEST_TIMEOUT_MS,
    keep_alive: {
      enabled: true,
      idle_socket_ttl: 1500,
    },
    log: { LoggerClass: ClickHouseLogger },
  });

  return wrapWithDefaultSettings(
    withStatementLimit({
      client: createResilientClickHouseClient({ client: raw, cluster }),
      // The pool size, so this bounds where the pool used to and capacity is
      // unchanged. The difference is that the queue in front of it is finite,
      // timed and counted.
      maxConcurrent: maxOpenConnections,
      instance,
    }),
  );
}
