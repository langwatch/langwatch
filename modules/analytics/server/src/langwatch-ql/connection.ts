/**
 * LangWatchQL analytics SQL — the connection shape and how it is derived.
 *
 * The one thing the query path and the provisioning path both need is the
 * restricted identity's connection: the executor serves with it, and
 * provisioning converges the access model that makes it work. Holding the type
 * and its env derivation here keeps that dependency one-way — `executor.ts` and
 * everything under `provisioning/` reach *down* to this leaf, and this leaf
 * reaches back up to neither. Nothing here opens a socket, emits DDL, or knows
 * the view catalog; it is connection shape and connection shape only.
 *
 * @see ./executor.ts — builds the client from this connection
 * @see ./provisioning/selfProvisioning.ts — the deploy path that converges it
 * @see specs/analytics/lwql-api.feature
 */

import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:analytics:lwql:connection");

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
 * The connection-shape defaults self-provisioning falls back to, mirroring what
 * terraform provisions in the cloud (`langwatch-saas#1126`).
 *
 * Only the two values that describe the *connection* — the restricted identity
 * and the tenant setting — live here. The provisioning-shape defaults (the
 * PostgreSQL reader role, the named collection) stay in `selfProvisioning.ts`
 * with the DDL that uses them, so this leaf carries no dependency on the
 * provisioning modules.
 */
export const LWQL_CONNECTION_DEFAULTS = {
  restrictedUser: "langwatch_lwql",
  tenantSetting: "custom_api_key_hash",
} as const;

/**
 * Whether an explicitly-set `LWQL_CLICKHOUSE_URL` names a different server than
 * the one self-provisioning derived, which is refused for the same reason
 * `LWQL_DATABASE` is: provisioning creates the access model on the derived
 * server, so querying another would find none of it.
 *
 * Compared by origin rather than by string — the derived URL is normalised
 * (trailing slash, credentials and path stripped) and an operator's value
 * usually is not, so equal servers rarely spell the same. An unparseable value
 * disagrees with everything, which is the safe direction.
 */
function disagreesWithDerivedServer({
  explicitUrl,
  derivedOrigin,
}: {
  explicitUrl: string | undefined;
  derivedOrigin: string;
}): boolean {
  if (!explicitUrl) return false;
  let explicitOrigin: string | null = null;
  try {
    explicitOrigin = new URL(explicitUrl).origin;
  } catch {
    explicitOrigin = null;
  }
  if (explicitOrigin === derivedOrigin) return false;
  logger.error(
    { derivedOrigin },
    "LWQL_SELF_PROVISION cannot target a ClickHouse other than CLICKHOUSE_URL's own: provisioning would create the access model on one server while queries ran against another. Unset LWQL_CLICKHOUSE_URL, or configure the five LWQL_* variables explicitly without LWQL_SELF_PROVISION",
  );
  return true;
}

/**
 * `CLICKHOUSE_URL` reduced to the two things provisioning needs: the server to
 * reach, stripped of its admin credentials and path, and the database that URL
 * names. Every way the value can fail to yield both is refused here, with the
 * reason logged, so the caller carries one "unconfigured" branch instead of
 * six.
 */
function derivedAdminTarget({
  env,
}: {
  env: NodeJS.ProcessEnv;
}): { serverUrl: URL; database: string } | null {
  const adminUrl = env.CLICKHOUSE_URL;
  if (!adminUrl) {
    logger.warn(
      "LWQL_SELF_PROVISION is true but CLICKHOUSE_URL is not set — LangWatchQL stays unconfigured and every query will be refused",
    );
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(adminUrl);
  } catch {
    logger.warn(
      "LWQL_SELF_PROVISION is true but CLICKHOUSE_URL is not a parseable URL — LangWatchQL stays unconfigured and every query will be refused",
    );
    return null;
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!database) {
    logger.warn(
      "LWQL_SELF_PROVISION is true but CLICKHOUSE_URL names no database in its path — LangWatchQL stays unconfigured and every query will be refused",
    );
    return null;
  }
  if (env.LWQL_DATABASE && env.LWQL_DATABASE !== database) {
    logger.error(
      { lwqlDatabase: env.LWQL_DATABASE, adminDatabase: database },
      "LWQL_SELF_PROVISION cannot target a database other than CLICKHOUSE_URL's own: the key-map row policies and the key-map backfill would disagree. Unset LWQL_DATABASE, or configure the five LWQL_* variables explicitly without LWQL_SELF_PROVISION",
    );
    return null;
  }

  // Credentials stripped rather than carried: this URL is handed to a client
  // that authenticates as the restricted identity, and inline admin
  // credentials would win.
  const serverUrl = new URL(adminUrl);
  serverUrl.username = "";
  serverUrl.password = "";
  serverUrl.pathname = "/";
  serverUrl.search = "";
  return { serverUrl, database };
}

/**
 * Derives the restricted ClickHouse connection from the admin URL under
 * `LWQL_SELF_PROVISION`, or reports that this deployment has none.
 *
 * The LangWatchQL database is the admin URL's own database, exactly as the
 * cloud deploys it: the views live beside the fact tables, and the key-map row
 * policies reference the same database the migration created the table in. An
 * explicit `LWQL_DATABASE` or `LWQL_CLICKHOUSE_URL` naming a *different* target
 * is refused (null, logged) rather than honoured — the backfill would write one
 * key map while every row policy reads another, which is a silent
 * all-queries-refused outage, the exact class of misconfiguration
 * self-provisioning exists to remove.
 */
export function lwqlDerivedConnectionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LangWatchQLConnection | null {
  if (env.LWQL_SELF_PROVISION !== "true") return null;

  const password = env.LWQL_CLICKHOUSE_PASSWORD;
  if (!password) {
    logger.warn(
      "LWQL_SELF_PROVISION is true but LWQL_CLICKHOUSE_PASSWORD is not set — LangWatchQL stays unconfigured and every query will be refused",
    );
    return null;
  }

  const target = derivedAdminTarget({ env });
  if (!target) return null;

  if (
    disagreesWithDerivedServer({
      explicitUrl: env.LWQL_CLICKHOUSE_URL,
      derivedOrigin: target.serverUrl.origin,
    })
  ) {
    return null;
  }

  return {
    url: target.serverUrl.toString(),
    username:
      env.LWQL_CLICKHOUSE_USER ?? LWQL_CONNECTION_DEFAULTS.restrictedUser,
    password,
    database: target.database,
    tenantSetting:
      env.LWQL_TENANT_SETTING ?? LWQL_CONNECTION_DEFAULTS.tenantSetting,
  };
}
