/**
 * The LangWatchQL executor over a real ClickHouse endpoint.
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  LangWatchQLAppFunctionUnavailableError,
  LangWatchQLProvisioningIncompleteError,
  LangWatchQLResultTooLargeError,
  LangWatchQLUnavailableError,
  LangWatchQLUnknownIdentifierError,
} from "@langwatch/analytics-contract";
import {
  DEFAULT_LWQL_RESOURCE_LIMITS,
  LWQL_MAX_RESULT_BYTES,
} from "@langwatch/analytics-contract/langwatch-ql-limits";
import { nowInstant } from "@langwatch/time";

import { lwqlAppFunctionNames } from "../../rules/langwatch-ql-app-function-catalog.rules.ts";
import {
  type LangWatchQLConnection,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
  LangWatchQLExecutorRepository,
} from "../langwatch-ql-executor.repository.ts";
import {
  isClickHouseObjectAccessDeniedError,
  isClickHouseObjectMissingError,
  isClickHouseResultTooLargeError,
  isClickHouseUnknownFunctionError,
  isClickHouseUnknownIdentifierError,
  translateClickHouseQueryError,
  extractUnknownIdentifier,
} from "./clickhouse.query-error-translation.mapper.ts";
import { toError } from "./clickhouse.to-error.mapper.ts";

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
function namesAnAppFunction(sql: string): boolean {
  return lwqlAppFunctionNames().some((name) => new RegExp(`\\b${name}\\s*\\(`, "i").test(sql));
}

function refusalFor({
  error,
  durationMs,
  sql,
}: {
  error: unknown;
  durationMs: number;
  sql: string;
}): unknown {
  if (isClickHouseObjectMissingError(error)) {
    return new LangWatchQLUnavailableError({ reasons: [toError(error)] });
  }

  if (isClickHouseObjectAccessDeniedError(error)) {
    return new LangWatchQLProvisioningIncompleteError({ reasons: [toError(error)] });
  }

  if (isClickHouseUnknownIdentifierError(error)) {
    return new LangWatchQLUnknownIdentifierError({
      identifier: extractUnknownIdentifier(error),
      reasons: [toError(error)],
    });
  }

  // The profile's `max_result_rows` / `max_result_bytes` backstop fired: a bound-parameter
  // LIMIT the static validator cannot read still cannot outrun the row cap.
  if (isClickHouseResultTooLargeError(error)) {
    return new LangWatchQLResultTooLargeError(LWQL_MAX_RESULT_BYTES, { reasons: [toError(error)] });
  }

  // An unknown function in a statement that calls one of ours cannot be the
  // caller's: the catalog is what the provisioning DDL is generated from, so
  // the server is missing the projection UDFs this API declares. A statement
  // calling none falls through — there the name is a native function this
  // server is too old for, which "extraction functions unavailable" misnames.
  if (namesAnAppFunction(sql) && isClickHouseUnknownFunctionError(error)) {
    return new LangWatchQLAppFunctionUnavailableError({ reasons: [toError(error)] });
  }

  return translateClickHouseQueryError(error, durationMs);
}

/** An executor that runs LangWatchQL as the restricted identity. */
export class ClickHouseLangWatchQLExecutorRepository extends LangWatchQLExecutorRepository {
  static create({
    connection,
  }: {
    connection: LangWatchQLConnection;
  }): ClickHouseLangWatchQLExecutorRepository {
    return new ClickHouseLangWatchQLExecutorRepository(
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
  }: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    const startedAt = nowInstant().epochMilliseconds;

    try {
      const resultSet = await this.client.query({
        // The statement the service handed down. The only thing the transport
        // adds is the `FORMAT` the driver appends to read the response.
        query: sql,
        format: "JSON",
        clickhouse_settings: { [this.connection.tenantSetting]: tenantCapability },
        query_params: parameters as Record<string, unknown> | undefined,
      });
      const response = await resultSet.json<Record<string, unknown>>();
      const rows = response.data;

      return {
        columns: response.meta ?? [],
        rows,
        statistics: {
          elapsedMs: elapsedMs(response.statistics?.elapsed),
          rowsRead: response.statistics?.rows_read ?? 0,
          bytesRead: response.statistics?.bytes_read ?? 0,
          rowsReturned: rows.length,
        },
      };
    } catch (error) {
      throw refusalFor({ error, durationMs: nowInstant().epochMilliseconds - startedAt, sql });
    }
  }

  override async close(): Promise<void> {
    await this.client.close();
  }
}
