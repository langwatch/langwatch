/**
 * Governed analytics SQL — the execution seam.
 *
 * The service decides *whether* a query may run; this decides *how* it runs,
 * and it is the only place in the module that opens a database connection.
 * Keeping it behind an interface is what lets the endpoint suite drive the
 * shipped service against a Testcontainers-provisioned server while the
 * deployment story — where the restricted identity's credentials come from,
 * how the key map is populated — lands in a later slice without touching the
 * service at all.
 *
 * ## Two rules that are not negotiable
 *
 * **Never the application's own client.** `~/server/clickhouse/client` is the
 * administrative connection: it is not `readonly`, it carries no tenant
 * capability, and no row policy applies to it. Running a customer's SQL through
 * it would return every tenant's rows. This module therefore builds its own
 * client from credentials that name the restricted identity, and an
 * unconfigured deployment gets no executor at all rather than a fallback.
 *
 * **Only the tenant capability travels as a setting.** The settings profile
 * pins `readonly = 1` and the resource ceilings `CONST`, so any other setting
 * sent per query is refused by the server. That is the design, not a limitation
 * to work around: the ceilings this layer adds are about the *result* — how
 * much of it is handed back — and never about relaxing what the database will
 * do.
 *
 * @see ./provisioning.ts — the identity, the profile, and the key map
 * @see ./capability.ts — the value sent as the tenant setting
 * @see specs/analytics/governed-sql-api.feature
 */

import { type ClickHouseClient, createClient } from "@clickhouse/client";

import { translateClickHouseQueryError } from "~/server/app-layer/clients/clickhouse/translate-query-error";

/** One column of a result, as the server typed it. */
export interface GovernedSqlColumn {
  /** Output name, which is the caller's alias when they wrote one. */
  readonly name: string;
  /** ClickHouse type, verbatim — `Nullable(Float64)`, `Map(String, String)`. */
  readonly type: string;
}

/** What the query cost, from the server's own accounting. */
export interface GovernedSqlStatistics {
  readonly elapsedMs: number;
  /** Physical rows read off the parts — the number partition pruning moves. */
  readonly rowsRead: number;
  readonly bytesRead: number;
  /** Rows handed back, after the result ceilings. */
  readonly rowsReturned: number;
}

/** A submitted, already-validated query and the ceilings on what it returns. */
export interface GovernedSqlExecutionRequest {
  /** Exactly as the caller wrote it. Never rewritten. */
  readonly sql: string;
  /** Values for the parameters the SQL declares. */
  readonly parameters?: Readonly<Record<string, unknown>>;
  /** The caller's tenant capability, sent as the one changeable setting. */
  readonly tenantCapability: string;
  readonly limits: GovernedSqlResultLimits;
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
export interface GovernedSqlResultLimits {
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
export const DEFAULT_GOVERNED_SQL_RESULT_LIMITS: GovernedSqlResultLimits = {
  maxRows: 10_000,
  maxResultBytes: 8_000_000,
};

/** A finished execution, already bounded by the result ceilings. */
export interface GovernedSqlExecutionResult {
  readonly columns: readonly GovernedSqlColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly statistics: GovernedSqlStatistics;
  /** Whether a ceiling cut the result short. Never silent. */
  readonly truncated: boolean;
}

/** The narrow seam the service depends on. */
export interface GovernedSqlExecutor {
  execute(
    request: GovernedSqlExecutionRequest,
  ): Promise<GovernedSqlExecutionResult>;
}

/** How to reach the governed schema as the restricted identity. */
export interface GovernedSqlConnection {
  /** ClickHouse HTTP endpoint. */
  readonly url: string;
  /** The restricted identity — never an administrative account. */
  readonly username: string;
  readonly password: string;
  /** Database an unqualified table name resolves to, i.e. the governed one. */
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
export function applyGovernedResultLimits({
  rows,
  limits,
}: {
  rows: readonly Record<string, unknown>[];
  limits: GovernedSqlResultLimits;
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
 * An executor that runs governed SQL as the restricted identity.
 *
 * The client is built here rather than taken as an argument so that the two
 * properties that make it safe — the identity it authenticates as, and the fact
 * that the tenant capability is the only setting it ever sends — are decided in
 * one place instead of at every call site.
 */
export function createGovernedSqlExecutor(
  connection: GovernedSqlConnection,
): GovernedSqlExecutor {
  const client: ClickHouseClient = createClient({
    url: connection.url,
    username: connection.username,
    password: connection.password,
    database: connection.database,
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
        const { rows, truncated } = applyGovernedResultLimits({
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
        // Reuses the read path's translation, so the two resource ceilings a
        // caller can act on arrive as the platform's existing codes rather than
        // as a second vocabulary for the same two failures. Anything it does
        // not recognise stays unhandled and degrades to "unknown" — correct,
        // because a driver diagnostic is not something a caller can act on and
        // is exactly the kind of text this API must not relay.
        throw translateClickHouseQueryError(error, Date.now() - startedAt);
      }
    },
  };
}

/**
 * Reads the restricted identity's connection from the environment, or reports
 * that this deployment has none.
 *
 * `null` rather than a throw, and rather than a default pointing at the
 * application's own ClickHouse: an unconfigured deployment must refuse governed
 * queries, and a partially-configured one must refuse them too. Every field is
 * required for exactly that reason.
 */
export function governedSqlConnectionFromEnv(): GovernedSqlConnection | null {
  const url = process.env.GOVERNED_SQL_CLICKHOUSE_URL;
  const username = process.env.GOVERNED_SQL_CLICKHOUSE_USER;
  const password = process.env.GOVERNED_SQL_CLICKHOUSE_PASSWORD;
  const database = process.env.GOVERNED_SQL_DATABASE;
  const tenantSetting = process.env.GOVERNED_SQL_TENANT_SETTING;
  if (!url || !username || !password || !database || !tenantSetting)
    return null;
  return { url, username, password, database, tenantSetting };
}
