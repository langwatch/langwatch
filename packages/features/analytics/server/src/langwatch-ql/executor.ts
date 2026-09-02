/**
 * The only LangWatchQL database seam. It opens the restricted identity, never
 * the application's administrative client: that client has no tenant row
 * policy. The tenant capability is the sole query setting; the database profile
 * pins read-only and resource limits, while this layer only bounds the result.
 */

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import type {
  LangWatchQLColumn,
  LangWatchQLStatistics,
} from "@langwatch/analytics-contract";

import {
  isClickHouseObjectUnavailableError,
  translateClickHouseQueryError,
} from "../clickhouse/translate-query-error";
import { toError } from "../clickhouse/to-error";

import { LangWatchQLUnavailableError } from "./errors";
import { DEFAULT_LWQL_RESOURCE_LIMITS } from "./provisioning";

const logger = createLogger("langwatch:analytics:lwql:executor");

export type {
  LangWatchQLColumn,
  LangWatchQLStatistics,
} from "@langwatch/analytics-contract";

/** A submitted, already-validated query and the ceilings on what it returns. */
export interface LangWatchQLExecutionRequest {
  /** Exactly as the caller wrote it. Never rewritten. */
  readonly sql: string;
  /** Values for the parameters the SQL declares. */
  readonly parameters?: Readonly<Record<string, unknown>>;
  /** The caller's tenant capability, sent as the one changeable setting. */
  readonly tenantCapability: string;
  readonly limits: LangWatchQLResultLimits;
}

/**
 * How much of a result reaches the caller.
 *
 * Distinct from the ceilings the settings profile pins, and the distinction is
 * the whole design: the database's ceilings decide whether the query is allowed
 * to *finish* and throw when it is not, while these decide how much of a
 * finished result is serialised into the response. Overflow here is never
 * silent — the result carries `truncated`, and the service turns that into a
 * diagnostic the caller can branch on.
 */
export interface LangWatchQLResultLimits {
  /** Most rows a response may carry. */
  readonly maxRows: number;
  /** Approximate JSON byte budget for those rows. */
  readonly maxResultBytes: number;
}

/**
 * The shipped result ceilings.
 *
 * Sized so a full page of an analytical answer fits comfortably — the shapes
 * the issue enumerates aggregate to tens or hundreds of rows — while a query
 * that forgot to aggregate is cut off long before the response becomes
 * something a caller has to stream.
 */
export const DEFAULT_LWQL_RESULT_LIMITS: LangWatchQLResultLimits = {
  maxRows: 10_000,
  maxResultBytes: 8_000_000,
};

/** A finished execution, already bounded by the result ceilings. */
export interface LangWatchQLExecutionResult {
  readonly columns: readonly LangWatchQLColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly statistics: LangWatchQLStatistics;
  /** Whether a ceiling cut the result short. Never silent. */
  readonly truncated: boolean;
}

/** The narrow seam the service depends on. */
export interface LangWatchQLExecutor {
  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult>;
  /**
   * Releases whatever transport this executor holds.
   *
   * Optional because most implementations of this seam are test doubles that
   * hold nothing. The real one owns a connection pool, and a process that
   * replaces its service — which the endpoint suites do several times per
   * file — would otherwise leave the previous pool's sockets open against the
   * same server for the lifetime of the process.
   */
  close?(): Promise<void>;
}

/** How to reach the LangWatchQL schema as the restricted identity. */
export interface LangWatchQLConnection {
  /** ClickHouse HTTP endpoint. */
  readonly url: string;
  /** The restricted identity — never an administrative account. */
  readonly username: string;
  readonly password: string;
  /** Database an unqualified table name resolves to, i.e. the LangWatchQL one. */
  readonly database: string;
  /** Custom setting carrying the tenant capability, per the settings profile. */
  readonly tenantSetting: string;
}

/**
 * Applies the row ceiling, then the byte ceiling, reporting whether either bit.
 *
 * Byte cost is measured on the JSON encoding of each retained row, which is
 * what the response body actually carries. It is an accounting of the *result*,
 * not of the query: the rows were already materialised by the time this runs,
 * so this bounds what a caller receives rather than what the gateway holds.
 * Bounding the latter is the database's job and it already does it, with
 * `max_memory_usage` pinned `CONST` by the profile.
 */
export function applyLangWatchQLResultLimits({
  rows,
  limits,
}: {
  rows: readonly Record<string, unknown>[];
  limits: LangWatchQLResultLimits;
}): { rows: Record<string, unknown>[]; truncated: boolean } {
  const capped = rows.slice(0, limits.maxRows);
  let truncated = capped.length < rows.length;

  const kept: Record<string, unknown>[] = [];
  let bytes = 0;
  for (const row of capped) {
    bytes += JSON.stringify(row)?.length ?? 0;
    if (bytes > limits.maxResultBytes) {
      truncated = true;
      break;
    }
    kept.push(row);
  }
  return { rows: kept, truncated };
}

/** ClickHouse reports elapsed time in seconds; the response speaks milliseconds. */
function elapsedMs(elapsedSeconds: number | undefined): number {
  return Math.round((elapsedSeconds ?? 0) * 1000);
}

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
const LWQL_REQUEST_TIMEOUT_MS =
  (DEFAULT_LWQL_RESOURCE_LIMITS.maxExecutionTimeSeconds + 5) * 1000;

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

/**
 * An executor that runs LangWatchQL as the restricted identity.
 *
 * The client is built here rather than taken as an argument so that the two
 * properties that make it safe — the identity it authenticates as, and the fact
 * that the tenant capability is the only setting it ever sends — are decided in
 * one place instead of at every call site.
 */
export function createLangWatchQLExecutor(
  connection: LangWatchQLConnection,
): LangWatchQLExecutor {
  const client: ClickHouseClient = createClient({
    url: connection.url,
    username: connection.username,
    password: connection.password,
    database: connection.database,
    request_timeout: LWQL_REQUEST_TIMEOUT_MS,
    max_open_connections: LWQL_MAX_OPEN_CONNECTIONS,
  });

  return {
    async execute({ sql, parameters, tenantCapability, limits }) {
      const startedAt = Date.now();
      try {
        const resultSet = await client.query({
          // The submitted statement, unmodified. The only thing the transport
          // adds is the `FORMAT` the driver appends to read the response.
          query: sql,
          format: "JSON",
          clickhouse_settings: { [connection.tenantSetting]: tenantCapability },
          query_params: parameters as Record<string, unknown> | undefined,
        });
        const response = await resultSet.json<Record<string, unknown>>();
        const { rows, truncated } = applyLangWatchQLResultLimits({
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
        // An unknown table/database or an access refusal cannot be the
        // caller's SQL: the validator only lets catalog-approved names reach
        // this point. It is a deployment whose LangWatchQL objects or grants
        // are missing — the same "not provisioned here" condition as a null
        // executor, and it gets the same answer. The raw error rides in
        // `reasons` for the operator's logs and never in the response.
        if (isClickHouseObjectUnavailableError(error)) {
          throw new LangWatchQLUnavailableError({ reasons: [toError(error)] });
        }
        // Reuses the read path's translation, so the two resource ceilings a
        // caller can act on arrive as the platform's existing codes rather than
        // as a second vocabulary for the same two failures. Anything it does
        // not recognise stays unhandled and degrades to "unknown" — correct,
        // because a driver diagnostic is not something a caller can act on and
        // is exactly the kind of text this API must not relay.
        throw translateClickHouseQueryError(error, Date.now() - startedAt);
      }
    },

    async close() {
      await client.close();
    },
  };
}

/**
 * Reads the restricted identity's connection from the environment, or reports
 * that this deployment has none.
 *
 * `null` rather than a throw, and rather than a default pointing at the
 * application's own ClickHouse: an unconfigured deployment must refuse LangWatchQL
 * queries, and a partially-configured one must refuse them too. Every field is
 * required for exactly that reason.
 *
 * The two cases are indistinguishable to a caller and must not be to an
 * operator, so a partial configuration is logged with the names it is missing.
 * They are not read through the validated env module: the variables are
 * optional by design — most deployments provision no LangWatchQL identity — and an
 * optional entry there would not reject a misspelling either, while making them
 * required would refuse to boot every deployment that does not run this API.
 */
export function lwqlConnectionFromEnv(): LangWatchQLConnection | null {
  const url = process.env.LWQL_CLICKHOUSE_URL;
  const username = process.env.LWQL_CLICKHOUSE_USER;
  const password = process.env.LWQL_CLICKHOUSE_PASSWORD;
  const database = process.env.LWQL_DATABASE;
  const tenantSetting = process.env.LWQL_TENANT_SETTING;

  const required = [
    ["LWQL_CLICKHOUSE_URL", url],
    ["LWQL_CLICKHOUSE_USER", username],
    ["LWQL_CLICKHOUSE_PASSWORD", password],
    ["LWQL_DATABASE", database],
    ["LWQL_TENANT_SETTING", tenantSetting],
  ] as const;
  const absent = required.filter(([, value]) => !value).map(([name]) => name);

  if (absent.length > 0) {
    // A deployment that set *some* of these meant to enable the API and got a
    // silent refusal on every query instead, so name what is missing. One that
    // set none is simply not running the API and says nothing. Variable names
    // only, never their values — one of these is a password.
    if (absent.length < required.length) {
      logger.warn(
        { absent },
        "LangWatchQL is partially configured, so every query will be refused",
      );
    }
    return null;
  }
  // Re-checked rather than asserted: `absent` is computed by a callback, which
  // TypeScript cannot use to narrow these five, and reaching for `!` here would
  // silently outlive someone editing the list above.
  if (!url || !username || !password || !database || !tenantSetting) return null;

  return { url, username, password, database, tenantSetting };
}
