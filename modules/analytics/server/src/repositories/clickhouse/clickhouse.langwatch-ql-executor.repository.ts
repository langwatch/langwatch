/**
 * The LangWatchQL executor over a real ClickHouse endpoint.
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
  LangWatchQLExecutor,
} from "../langwatch-ql-executor.repository.ts";
import {
  isClickHouseObjectUnavailableError,
  isClickHouseUnknownIdentifierError,
  translateClickHouseQueryError,
  unknownIdentifierFromError,
} from "./clickhouse.query-error-translation.mapper.ts";
import { toError } from "./clickhouse.to-error.mapper.ts";
import { DEFAULT_LWQL_RESOURCE_LIMITS } from "../../services/langwatch-ql-access-model.service.ts";
import { LangWatchQLExecutorService } from "../../services/langwatch-ql-executor.service.ts";

const executorService = LangWatchQLExecutorService.create();

/**
 * How long the driver waits on a LangWatchQL query, in milliseconds.
 */
const LWQL_REQUEST_TIMEOUT_MS = (DEFAULT_LWQL_RESOURCE_LIMITS.maxExecutionTimeSeconds + 5) * 1000;

/**
 * Sockets this process may hold open against the LangWatchQL endpoint at once.
 */
const LWQL_MAX_OPEN_CONNECTIONS = 10;

/** ClickHouse reports elapsed time in seconds; the response speaks milliseconds. */
function elapsedMs(elapsedSeconds: number | undefined): number {
  return Math.round((elapsedSeconds ?? 0) * 1000);
}

/**
 * What a failed governed run is reported as.
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
export class ClickHouseLangWatchQLExecutorAdapter extends LangWatchQLExecutor {
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
