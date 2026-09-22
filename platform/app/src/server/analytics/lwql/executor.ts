/**
 * LangWatchQL analytics SQL — the execution seam.
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
 * @see ./provisioning/accessModel.ts — the identity, the profile, and the key map
 * @see ./capability.ts — the value sent as the tenant setting
 * @see specs/lwql/api.feature
 */

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";

import {
  isClickHouseObjectAccessDeniedError,
  isClickHouseObjectMissingError,
  isClickHouseResultTooLargeError,
  isClickHouseUnknownFunctionError,
  isClickHouseUnknownIdentifierError,
  translateClickHouseQueryError,
  unknownIdentifierFromError,
} from "~/server/app-layer/clients/clickhouse/translate-query-error";
import { toError } from "~/utils/posthogErrorCapture";
import {
  type LangWatchQLConnection,
  lwqlDerivedConnectionFromEnv,
} from "./connection";
import {
  LangWatchQLAppFunctionUnavailableError,
  LangWatchQLProvisioningIncompleteError,
  LangWatchQLResultTooLargeError,
  LangWatchQLUnavailableError,
  LangWatchQLUnknownIdentifierError,
} from "./errors";
import {
  DEFAULT_LWQL_RESOURCE_LIMITS,
  LWQL_MAX_RESULT_BYTES,
  LWQL_MAX_RESULT_ROWS,
} from "./limits";

const logger = createLogger("langwatch:analytics:lwql:executor");

/** One column of a result, as the server typed it. */
export interface LangWatchQLColumn {
  /** Output name, which is the caller's alias when they wrote one. */
  readonly name: string;
  /** ClickHouse type, verbatim — `Nullable(Float64)`, `Map(String, String)`. */
  readonly type: string;
}

/** What the query cost, from the server's own accounting. */
export interface LangWatchQLStatistics {
  readonly elapsedMs: number;
  /** Physical rows read off the parts — the number partition pruning moves. */
  readonly rowsRead: number;
  readonly bytesRead: number;
  /** Rows handed back. */
  readonly rowsReturned: number;
}

/** A submitted, already-validated query as it reaches the transport. */
export interface LangWatchQLExecutionRequest {
  /**
   * The statement to run. The caller's, with one exception: the service appends
   * a default `LIMIT` to a statement that names none (see `LWQL_MAX_RESULT_ROWS`
   * and `lwql.service.ts`). Nothing else is ever added.
   */
  readonly sql: string;
  /** Values for the parameters the SQL declares. */
  readonly parameters?: Readonly<Record<string, unknown>>;
  /** The caller's tenant capability, sent as the one changeable setting. */
  readonly tenantCapability: string;
  /**
   * Whether this statement calls an app function.
   *
   * Only used to read `UNKNOWN_FUNCTION` correctly. The validator's allowlist
   * also admits native ClickHouse functions, and the BYO contract pins no
   * server version, so an older server can refuse a native-only query with the
   * same error. Mapping that to "the extraction functions are not provisioned"
   * would name the wrong cause and hand the caller an action that changes
   * nothing.
   */
  readonly usesAppFunctions?: boolean;
}

/**
 * The two numeric bounds this API applies to a result, held together because
 * `DEFAULT_LWQL_RESULT_LIMITS` and every test that lowers a bound name them as a
 * pair. Neither is enforced *here*: the executor is a pure transport now. The
 * service reads `maxRows` to size the `LIMIT` it appends to an unbounded
 * statement, and `maxResultBytes` to reject an oversized result outright.
 */
export interface LangWatchQLResultLimits {
  /** The row cap — the `LIMIT` appended to a bare statement. */
  readonly maxRows: number;
  /** The hard JSON byte ceiling; a result past it is refused, never cut. */
  readonly maxResultBytes: number;
  /**
   * Byte budget for the result *after* the app-function hydration stage has
   * replaced keys with values.
   *
   * A second, much larger ceiling rather than a raised `maxResultBytes`,
   * because the two bound different things. The database returns a page of
   * keys, which is small by construction; the application then puts a
   * conversation or a whole trace in each of them, which is where a response
   * reaches megabytes. Bounding only the first would let the second grow
   * unbounded; bounding both with one number would refuse ordinary key-only
   * queries to make room for hydrated ones.
   */
  readonly maxHydratedBytes: number;
  /**
   * Byte ceiling for a single hydrated value.
   *
   * One trace in a page of a hundred can be far larger than the rest. Cutting
   * that cell and saying so costs the caller one value; letting it consume the
   * whole result ceiling would cost them the ninety-nine rows after it.
   */
  readonly maxHydratedValueBytes: number;
}

/**
 * The shipped result bounds.
 *
 * Single-sourced from `./limits.ts` so the validator (which refuses a too-high
 * `LIMIT`), the service (which appends the default one and enforces the byte
 * ceiling) and this default all read the same two numbers.
 */
export const DEFAULT_LWQL_RESULT_LIMITS: LangWatchQLResultLimits = {
  maxRows: LWQL_MAX_RESULT_ROWS,
  maxResultBytes: LWQL_MAX_RESULT_BYTES,
  maxHydratedBytes: 32_000_000,
  maxHydratedValueBytes: 4_000_000,
};

/** A finished execution. Every row the database returned; the service bounds them. */
export interface LangWatchQLExecutionResult {
  readonly columns: readonly LangWatchQLColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly statistics: LangWatchQLStatistics;
}

/** The narrow seam the service depends on. */
export interface LangWatchQLExecutor {
  execute(
    request: LangWatchQLExecutionRequest,
  ): Promise<LangWatchQLExecutionResult>;
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
 * never in the response. Lifted out of the `execute` body rather than inlined
 * so the decision has a name, and so `execute` stays within the complexity
 * budget the house rules enforce on changed lines.
 */
function refusalFor({
  error,
  durationMs,
  usesAppFunctions,
}: {
  error: unknown;
  durationMs: number;
  usesAppFunctions: boolean;
}): unknown {
  // An unknown table/database or an access refusal cannot be the caller's SQL:
  // the validator only lets catalog-approved names reach this point. Both mean
  // this deployment's LangWatchQL objects or grants are incomplete, but not the
  // same way, and the customer-facing codes say so differently.
  if (isClickHouseObjectMissingError(error)) {
    // The object itself is not there — the same "not provisioned here"
    // condition as a null executor (no restricted identity configured at all).
    return new LangWatchQLUnavailableError({ reasons: [toError(error)] });
  }
  if (isClickHouseObjectAccessDeniedError(error)) {
    // The object exists; this identity's grants on it are incomplete — narrower
    // than "not provisioned," and purely our own gap rather than something a
    // customer's workspace administrator could act on.
    return new LangWatchQLProvisioningIncompleteError({
      reasons: [toError(error)],
    });
  }
  if (isClickHouseUnknownIdentifierError(error)) {
    return new LangWatchQLUnknownIdentifierError({
      identifier: unknownIdentifierFromError(error),
      reasons: [toError(error)],
    });
  }
  if (isClickHouseResultTooLargeError(error)) {
    // The server-side backstop (`max_result_rows` / `max_result_bytes`)
    // fired — the validator's static LIMIT check cannot see a bound
    // parameter, but the profile's ceiling still catches it. Same customer
    // code as the post-fetch byte check, never the raw driver diagnostic.
    return new LangWatchQLResultTooLargeError(LWQL_MAX_RESULT_BYTES, {
      reasons: [toError(error)],
    });
  }
  // An unknown function in a statement that calls one of ours cannot be the
  // caller's either: the catalog is what the provisioning DDL is generated
  // from, so the server is missing the projection UDFs this API declares,
  // which is a deployment gap rather than anything a customer wrote. A
  // statement that calls none falls through to the ordinary translation: there
  // the unknown name is a native function this server is too old for, and
  // saying "extraction functions unavailable" would misname it.
  if (usesAppFunctions && isClickHouseUnknownFunctionError(error)) {
    return new LangWatchQLAppFunctionUnavailableError({
      reasons: [toError(error)],
    });
  }
  return translateClickHouseQueryError(error, durationMs);
}

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
    async execute({ sql, parameters, tenantCapability, usesAppFunctions }) {
      const startedAt = Date.now();
      try {
        const resultSet = await client.query({
          // The statement the service handed down — the caller's, save for a
          // default `LIMIT` appended upstream when they named none. The only
          // thing the transport adds is the `FORMAT` the driver needs.
          query: sql,
          format: "JSON",
          clickhouse_settings: { [connection.tenantSetting]: tenantCapability },
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
          error,
          durationMs: Date.now() - startedAt,
          usesAppFunctions: usesAppFunctions === true,
        });
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
  // Self-provisioning (issue #6635) owns the target: `provisionLwql` creates
  // the access model on the connection derived from the admin `CLICKHOUSE_URL`,
  // so resolving a *different* connection here would query a server where none
  // of it exists. Checked before `absent` rather than after: a deployment that
  // sets all five explicitly *and* `LWQL_SELF_PROVISION` would otherwise fall
  // through to the explicit values and split provisioning from querying.
  // `lwqlDerivedConnectionFromEnv` treats the per-field `LWQL_*` as overrides
  // and refuses outright on one that cannot be honoured.
  if (process.env.LWQL_SELF_PROVISION === "true") {
    return lwqlDerivedConnectionFromEnv();
  }

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
  if (!url || !username || !password || !database || !tenantSetting)
    return null;

  return { url, username, password, database, tenantSetting };
}
