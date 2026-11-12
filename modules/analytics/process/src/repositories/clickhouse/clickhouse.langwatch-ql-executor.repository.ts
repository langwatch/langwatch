/**
 * The LangWatchQL executor over a real ClickHouse endpoint.
 */
import { type ClickHouseClient, ClickHouseLogLevel, createClient } from "@clickhouse/client";
import {
  LangWatchQLAppFunctionUnavailableError,
  LangWatchQLBusyError,
  LangWatchQLInvalidQueryError,
  LangWatchQLParameterInvalidError,
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

import { lwqlAppFunctionNames } from "../../features/app-functions/rules/langwatch-ql-app-function-catalog.rules.ts";
import {
  withoutTenantCapability,
  withTenantCapability,
} from "../../rules/langwatch-ql-tenant-capability.rules.ts";
import {
  type LangWatchQLConnection,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
  LangWatchQLExecutorRepository,
} from "../langwatch-ql-executor.repository.ts";
import {
  extractBadQueryParameter,
  isClickHouseBadQueryParameterError,
  isClickHouseInvalidQueryError,
  isClickHouseObjectAccessDeniedError,
  isClickHouseObjectMissingError,
  isClickHouseResultTooLargeError,
  isClickHouseTooManyQueriesError,
  isClickHouseUnknownFunctionError,
  isClickHouseUnknownIdentifierError,
  translateClickHouseQueryError,
  extractUnknownIdentifier,
  toError,
} from "./clickhouse.query-error-translation.mapper.ts";

/**
 * How long the driver waits on a LangWatchQL query, in milliseconds.
 */
const LWQL_REQUEST_TIMEOUT_MS = (DEFAULT_LWQL_RESOURCE_LIMITS.maxExecutionTimeSeconds + 5) * 1000;

/**
 * Sockets this process may hold open against the LangWatchQL endpoint at once.
 */
const LWQL_MAX_OPEN_CONNECTIONS = 10;

/**
 * A copy of the driver's error with the capability taken out of its message, stack and text
 * fields, keeping its code, type, status and cause: ClickHouse quotes the failing statement back,
 * so no refusal's reasons, and no log of them, may hold the original. The driver's is untouched.
 */
function withoutCapability({ error, capability }: { error: unknown; capability: string }): unknown {
  if (!(error instanceof Error) || capability === "") return error;
  const scrub = (text: string) => withoutTenantCapability({ text, capability });
  const scrubbed = new Error(scrub(error.message), { cause: error.cause });
  scrubbed.name = error.name;
  if (error.stack !== undefined) scrubbed.stack = scrub(error.stack);
  const fields = Object.entries(error).map(([key, value]) => [
    key,
    typeof value === "string" ? scrub(value) : value,
  ]);
  return Object.assign(scrubbed, Object.fromEntries(fields));
}

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

  if (isClickHouseBadQueryParameterError(error)) {
    return new LangWatchQLParameterInvalidError({
      parameter: extractBadQueryParameter(error),
      reasons: [toError(error)],
    });
  }

  // The profile's `max_result_rows` / `max_result_bytes` backstop fired: a bound-parameter
  // LIMIT the static validator cannot read still cannot outrun the row cap.
  if (isClickHouseResultTooLargeError(error)) {
    return new LangWatchQLResultTooLargeError(LWQL_MAX_RESULT_BYTES, { reasons: [toError(error)] });
  }

  // The shared identity is at its concurrency ceiling: refused before running,
  // and worth the caller's retry rather than an unknown 500.
  if (isClickHouseTooManyQueriesError(error)) {
    return new LangWatchQLBusyError({ reasons: [toError(error)] });
  }

  // An unknown function in a statement that calls one of ours cannot be the
  // caller's: the catalog is what the provisioning DDL is generated from, so
  // the server is missing the projection UDFs this API declares. A statement
  // calling none falls through — there the name is a native function this
  // server is too old for, which "extraction functions unavailable" misnames.
  if (namesAnAppFunction(sql) && isClickHouseUnknownFunctionError(error)) {
    return new LangWatchQLAppFunctionUnavailableError({ reasons: [toError(error)] });
  }

  // Last of the specific checks: a code here is a fault in the caller's SQL that the static
  // validator could not see, so it is theirs to fix rather than an unknown 500.
  if (isClickHouseInvalidQueryError(error)) {
    return new LangWatchQLInvalidQueryError({ reasons: [toError(error)] });
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
        // The driver's own logger prints a failed statement's server text, capability included;
        // a refusal reaches the app only through the scrubbed error.
        log: { level: ClickHouseLogLevel.OFF },
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
    projectIds,
  }: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    const statement = withTenantCapability({
      sql,
      setting: this.connection.tenantSetting,
      capability: tenantCapability,
      projectIds,
    });
    const startedAt = nowInstant().epochMilliseconds;

    try {
      const resultSet = await this.client.query({
        // The statement the service handed down and the capability's clause; the driver adds only
        // the `FORMAT` it reads the response in.
        query: statement,
        format: "JSON",
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
      throw refusalFor({
        error: withoutCapability({ error, capability: tenantCapability }),
        durationMs: nowInstant().epochMilliseconds - startedAt,
        sql,
      });
    }
  }

  override async close(): Promise<void> {
    await this.client.close();
  }
}
