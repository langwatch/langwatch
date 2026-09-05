/**
 * The LangWatchQL executor over a real ClickHouse endpoint.
 *
 * The client is built here rather than taken as an argument so that the two
 * properties that make it safe — the identity it authenticates as, and the fact
 * that the tenant capability is the only setting it ever sends — are decided in
 * one place instead of at every call site.
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  LangWatchQLUnavailableError,
  LangWatchQLUnknownIdentifierError,
} from "@langwatch/analytics-contract";

import {
  type LangWatchQLConnection,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
  LangWatchQLExecutorPort,
} from "../ports/langwatch-ql-executor.port";
import {
  isClickHouseObjectUnavailableError,
  isClickHouseUnknownIdentifierError,
  translateClickHouseQueryError,
  unknownIdentifierFromError,
} from "../repositories/clickhouse/clickhouse.query-error-translation.mapper";
import { toError } from "../repositories/clickhouse/clickhouse.to-error.mapper";
import { DEFAULT_LWQL_RESOURCE_LIMITS } from "../services/langwatch-ql-access-model.service";
import { LangWatchQLExecutorService } from "../services/langwatch-ql-executor.service";

const executorService = LangWatchQLExecutorService.create();

/**
 * How long the driver waits on a LangWatchQL query, in milliseconds.
 *
 * Deliberately *above* the shipped profile's `max_execution_time`, and derived
 * from it rather than written twice: the server's ceiling is the one a caller
 * can act on, because it arrives as a coded `query_timeout`. A socket the
 * driver abandoned first arrives as an unknown transport failure for the same
 * underlying event, which tells the caller nothing and pages us instead of
 * them. The margin covers the round trip and the server's own cancellation.
 *
 * A deployment that provisions the profile with a *higher* execution ceiling
 * has to raise this with it, or it gets the transport failure back.
 */
const LWQL_REQUEST_TIMEOUT_MS = (DEFAULT_LWQL_RESOURCE_LIMITS.maxExecutionTimeSeconds + 5) * 1000;

/**
 * Sockets this process may hold open against the LangWatchQL endpoint at once.
 *
 * Stated rather than defaulted so the LangWatchQL pool is a decision: it is a
 * second pool beside the application's own ClickHouse client, and the two
 * compete for the same server's connection budget. Pinned at the driver's own
 * default — there is no measurement saying otherwise yet — so that raising it
 * is a change someone makes on purpose.
 */
const LWQL_MAX_OPEN_CONNECTIONS = 10;

/** ClickHouse reports elapsed time in seconds; the response speaks milliseconds. */
function elapsedMs(elapsedSeconds: number | undefined): number {
  return Math.round((elapsedSeconds ?? 0) * 1000);
}

/**
 * What a failed governed run is reported as.
 *
 * Three answers, and which one applies is decided by what the server refused
 * rather than by anything the caller sent:
 *
 *  - **The deployment is incomplete.** An unknown table or database, or an
 *    access refusal, cannot be the caller's SQL: the validator only lets
 *    catalog-approved names reach here. So it is the same "not provisioned
 *    here" condition as having no executor at all, and gets the same answer.
 *  - **The caller named a column that is not there.** This one IS their SQL,
 *    and is the only refusal on this path they fix themselves. The validator
 *    approves table names, not columns, and column existence is not knowable
 *    when a chart is saved, so run time is the only place it can be named.
 *  - **Anything else** goes through the read path's own translation, so the
 *    resource ceilings a caller can act on arrive as the platform's existing
 *    codes rather than as a second vocabulary for the same failures. What that
 *    does not recognise stays unhandled and degrades to "unknown", which is
 *    correct: a driver diagnostic is not something a caller can act on, and is
 *    exactly the kind of text this API must not relay.
 *
 * In every case the raw error rides in `reasons` for the operator's logs and
 * never in the response.
 */
function refusalFor({ error, durationMs }: { error: unknown; durationMs: number }): unknown {
  if (isClickHouseObjectUnavailableError(error)) {
    return new LangWatchQLUnavailableError({ reasons: [toError(error)] });
  }

  if (isClickHouseUnknownIdentifierError(error)) {
    return new LangWatchQLUnknownIdentifierError({
      identifier: unknownIdentifierFromError(error),
      reasons: [toError(error)],
    });
  }

  return translateClickHouseQueryError(error, durationMs);
}

/** An executor that runs LangWatchQL as the restricted identity. */
export class ClickHouseLangWatchQLExecutorAdapter extends LangWatchQLExecutorPort {
  static create({
    connection,
  }: {
    connection: LangWatchQLConnection;
  }): ClickHouseLangWatchQLExecutorAdapter {
    return new ClickHouseLangWatchQLExecutorAdapter(
      connection,
      createClient({
        url: connection.url,
        username: connection.username,
        password: connection.password,
        database: connection.database,
        request_timeout: LWQL_REQUEST_TIMEOUT_MS,
        max_open_connections: LWQL_MAX_OPEN_CONNECTIONS,
      }),
    );
  }

  private constructor(
    private readonly connection: LangWatchQLConnection,
    private readonly client: ClickHouseClient,
  ) {
    super();
  }

  async execute({
    sql,
    parameters,
    tenantCapability,
    limits,
  }: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    const startedAt = Date.now();

    try {
      const resultSet = await this.client.query({
        // The submitted statement, unmodified. The only thing the transport
        // adds is the `FORMAT` the driver appends to read the response.
        query: sql,
        format: "JSON",
        clickhouse_settings: { [this.connection.tenantSetting]: tenantCapability },
        query_params: parameters as Record<string, unknown> | undefined,
      });
      const response = await resultSet.json<Record<string, unknown>>();
      const { rows, truncated } = executorService.applyResultLimits({
        rows: response.data,
        limits,
      });

      return {
        columns: response.meta ?? [],
        rows,
        truncated,
        statistics: {
          elapsedMs: elapsedMs(response.statistics?.elapsed),
          rowsRead: response.statistics?.rows_read ?? 0,
          bytesRead: response.statistics?.bytes_read ?? 0,
          rowsReturned: rows.length,
        },
      };
    } catch (error) {
      throw refusalFor({ error, durationMs: Date.now() - startedAt });
    }
  }

  override async close(): Promise<void> {
    await this.client.close();
  }
}
