/**
 * LangWatchQL app functions — the ClickHouse objects behind them.
 *
 * Each app function exists on the server as one SQL UDF that projects its key
 * arguments and nothing else. That is the whole of the database's involvement:
 * the value is the application's to compute, and the UDF is there so the
 * caller's statement runs **verbatim** — no rewriter, no `enrich` side channel
 * — while the returned column already carries the key hydration needs.
 *
 * ## Why a UDF rather than config
 *
 * The rest of the LangWatchQL access model is static config the server re-reads
 * at boot (ADR-101), and app functions cannot follow it: there is no XML form
 * of `CREATE FUNCTION` for a SQL UDF. The only config-time UDF form is
 * `user_defined_executable_functions_config`, which forks a process per call.
 * So these are the one SQL-provisioned object sitting beside a
 * config-provisioned access model, and ADR-136 records that as a deliberate
 * exception rather than drift.
 *
 * ## Three measured facts this module is shaped by
 *
 *  1. **Calling needs no grant.** A SQL UDF is callable by any identity;
 *     `system.grants` for the restricted user holds nothing matching
 *     `%FUNCTION%` and the call still works under `readonly = 1`. Creating,
 *     replacing, dropping and reloading are all refused with ACCESS_DENIED
 *     (497), which is an access-control refusal rather than a readonly one, so
 *     it holds even if `readonly` were ever relaxed. Nothing here grants the
 *     restricted identity anything, and {@link lwqlAppFunctionGrantAuditQuery}
 *     is what pins that.
 *  2. **Functions are global, with no database namespace.**
 *     `analytics.conversation(x)` is UNKNOWN_FUNCTION (46). One name per
 *     server, shared by every tenant, which is why the catalog treats the
 *     names as a public API and why a collision with a builtin has to be
 *     loud: `CREATE OR REPLACE FUNCTION length AS (k) -> k` is refused with
 *     FUNCTION_ALREADY_EXISTS (609).
 *  3. **`SHOW CREATE FUNCTION` does not exist** (SYNTAX_ERROR on 25.8). The
 *     definitions are readable from `system.functions.create_query`, and the
 *     single-argument form round-trips with its parentheses dropped
 *     (`CREATE FUNCTION f AS k -> k`), so nothing here compares submitted text
 *     against stored text. {@link lwqlAppFunctionConflicts} reads `origin`,
 *     which is the fact that actually matters.
 *
 * ## Replication
 *
 * A `CREATE FUNCTION` writes the local disk store, so on a multi-replica
 * server it lands on one replica only. The fix is a server setting rather than
 * anything here: `user_defined_zookeeper_path`, which the chart-managed
 * renderer declares in replicated mode
 * (`infra/clickhouse-serverless/internal/render/lwql.go`). With it, one create
 * reaches every replica and a replica rebuilt later picks the functions up at
 * boot — which `ON CLUSTER` would not do.
 *
 * @see ../appFunctions/catalog.ts — the declaration these statements render
 * @see dev/docs/adr/136-lwql-app-functions-identity-udfs.md
 * @see ../../../../../specs/analytics/lwql-app-functions.feature
 */

import {
  type LangWatchQLAppFunctionDefinition,
  LWQL_APP_FUNCTION_CATALOG,
  lwqlAppFunctionKeyParameters,
  lwqlAppFunctionNames,
} from "../appFunctions/catalog";
import { assertIdentifier, clickHouseLiteral } from "../sqlText";

/** The origin `system.functions` reports for a function created by SQL DDL. */
export const LWQL_SQL_UDF_ORIGIN = "SQLUserDefined";

/**
 * The body of one function's UDF: its key arguments, projected.
 *
 * The identity on the single key for almost every function. `tuple(...)` where
 * the key is a pair, because the identity would return only the first half and
 * the second would be lost in the database — the application would then have a
 * trace id and no span id to resolve it against.
 */
export function lwqlAppFunctionBody(
  definition: LangWatchQLAppFunctionDefinition,
): string {
  const keys = lwqlAppFunctionKeyParameters(definition).map((parameter) =>
    assertIdentifier(parameter.name, "app function parameter"),
  );
  const [only] = keys;
  if (keys.length === 0 || only === undefined) {
    throw new Error(
      `lwql app functions: "${definition.name}" declares no key parameter, so there is nothing for its UDF to project`,
    );
  }
  return keys.length === 1 ? only : `tuple(${keys.join(", ")})`;
}

/** One function's `CREATE OR REPLACE FUNCTION` statement. */
export function lwqlAppFunctionStatement(
  definition: LangWatchQLAppFunctionDefinition,
): string {
  const name = assertIdentifier(definition.name, "app function name");
  const parameters = definition.parameters
    .map((parameter) =>
      assertIdentifier(parameter.name, "app function parameter"),
    )
    .join(", ");
  return (
    `CREATE OR REPLACE FUNCTION ${name} AS (${parameters}) -> ` +
    lwqlAppFunctionBody(definition)
  );
}

/**
 * Every app function's DDL, in catalog order.
 *
 * `OR REPLACE` throughout, so a re-run converges rather than failing on what
 * is already there — the same idempotency every other generator in this
 * directory promises. The functions depend on nothing, so they can be applied
 * at any point in a provisioning run; the setup list puts them alongside the
 * other object creation, before the grants.
 */
export function lwqlAppFunctionStatements({
  functions = LWQL_APP_FUNCTION_CATALOG,
}: {
  functions?: readonly LangWatchQLAppFunctionDefinition[];
} = {}): string[] {
  return functions.map(lwqlAppFunctionStatement);
}

/**
 * Asks the server what it holds for exactly the declared names.
 *
 * Run as an administrative user at provisioning time. Reading `origin` rather
 * than comparing definitions is the point: what would break a deployment is
 * not a differing body but a name this catalog claims that the server owns as
 * something else, which is exactly what a future ClickHouse release adding a
 * `conversation` builtin would look like.
 */
export function lwqlAppFunctionReconciliationQuery({
  functions = LWQL_APP_FUNCTION_CATALOG,
}: {
  functions?: readonly LangWatchQLAppFunctionDefinition[];
} = {}): string {
  const names = lwqlAppFunctionNames(functions)
    .map((name) => clickHouseLiteral(name))
    .join(", ");
  return `SELECT name, origin FROM system.functions WHERE name IN (${names}) ORDER BY name`;
}

/** One row of {@link lwqlAppFunctionReconciliationQuery}. */
export interface LangWatchQLServerFunctionRow {
  readonly name: string;
  readonly origin: string;
}

/** A declared name the server holds as something other than our own UDF. */
export interface LangWatchQLAppFunctionConflict {
  readonly name: string;
  /** What the server says it is. `System` for a builtin. */
  readonly origin: string;
}

/**
 * The declared names the server already owns as something else.
 *
 * Empty is the healthy state, and it is also the honest answer *before* the
 * first provisioning run: a name with no row is a function that does not exist
 * yet, which the create statement is about to fix. Only a row whose origin is
 * not {@link LWQL_SQL_UDF_ORIGIN} is a conflict, and it is fatal rather than
 * idempotent — the create would be refused with FUNCTION_ALREADY_EXISTS, and a
 * caller's statement would otherwise quietly get the builtin's behaviour
 * instead of a hydrated column.
 */
export function lwqlAppFunctionConflicts({
  rows,
  functions = LWQL_APP_FUNCTION_CATALOG,
}: {
  rows: readonly LangWatchQLServerFunctionRow[];
  functions?: readonly LangWatchQLAppFunctionDefinition[];
}): readonly LangWatchQLAppFunctionConflict[] {
  const declared = new Set(lwqlAppFunctionNames(functions));
  return rows
    .filter((row) => declared.has(row.name))
    .filter((row) => row.origin !== LWQL_SQL_UDF_ORIGIN)
    .map((row) => ({ name: row.name, origin: row.origin }));
}
