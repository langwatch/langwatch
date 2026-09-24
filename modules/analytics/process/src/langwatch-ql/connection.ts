/**
 * LangWatchQL SQL: the connection shape and its derivation. Both the query path and
 * provisioning need the restricted identity's connection; holding it here keeps the dependency
 * one-way -- executor.ts and provisioning/ reach down to this leaf, never the reverse.
 * @see ./executor.ts — builds the client from this connection
 * @see ./provisioning/selfProvisioning.ts — the deploy path that converges it
 * @see specs/lwql/api.feature
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
 * Connection-shape defaults self-provisioning falls back to, mirroring terraform
 * (`langwatch-saas#1126`). Only the two *connection* values -- restricted identity, tenant
 * setting -- live here; provisioning-shape defaults stay in `selfProvisioning.ts`.
 */
export const LWQL_CONNECTION_DEFAULTS = {
  restrictedUser: "langwatch_lwql",
  tenantSetting: "custom_api_key_hash",
} as const;

/**
 * Whether an explicit `LWQL_CLICKHOUSE_URL` names a different server than the derived one --
 * refused, since provisioning creates the access model on the derived server only. Compared by
 * origin, not string, since the derived URL is normalised and an operator's rarely is.
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
    "LangWatchQL: LWQL_CLICKHOUSE_URL cannot name a ClickHouse other than CLICKHOUSE_URL's own — provisioning would create the access model on one server while queries ran against another. Unset LWQL_CLICKHOUSE_URL so it derives from CLICKHOUSE_URL",
  );
  return true;
}

/**
 * `CLICKHOUSE_URL` reduced to what provisioning needs: the server (stripped of admin
 * credentials and path) and the database it names. Every failure to yield both is refused and
 * logged here, so the caller carries one "unconfigured" branch instead of six.
 */
function deriveAdminTarget({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): { serverUrl: URL; database: string } | null {
  const adminUrl = env.CLICKHOUSE_URL;
  if (!adminUrl) {
    logger.warn(
      "LangWatchQL: CLICKHOUSE_URL is not set — LangWatchQL stays unconfigured and every query will be refused",
    );
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(adminUrl);
  } catch {
    logger.warn(
      "LangWatchQL: CLICKHOUSE_URL is not a parseable URL — LangWatchQL stays unconfigured and every query will be refused",
    );
    return null;
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!database) {
    logger.warn(
      "LangWatchQL: CLICKHOUSE_URL names no database in its path — LangWatchQL stays unconfigured and every query will be refused",
    );
    return null;
  }
  if (env.LWQL_DATABASE && env.LWQL_DATABASE !== database) {
    logger.error(
      { lwqlDatabase: env.LWQL_DATABASE, adminDatabase: database },
      "LangWatchQL: LWQL_DATABASE cannot name a database other than CLICKHOUSE_URL's own — the key-map row policies and the key-map backfill would disagree. Unset LWQL_DATABASE so it derives from CLICKHOUSE_URL",
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
 * Derives the restricted connection from the admin `CLICKHOUSE_URL` whenever a
 * `LWQL_CLICKHOUSE_PASSWORD` is present, or null. The database is the admin URL's own -- a
 * different `LWQL_DATABASE`/`_URL` is refused: a mismatch is a silent outage (ADR-159).
 */
export function deriveLwqlConnectionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LangWatchQLConnection | null {
  const password = env.LWQL_CLICKHOUSE_PASSWORD;
  if (!password) {
    // No password means this deployment is simply not running LangWatchQL —
    // silent, not a warning, exactly like an unset optional feature.
    return null;
  }

  const target = deriveAdminTarget({ env });
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
    username: env.LWQL_CLICKHOUSE_USER ?? LWQL_CONNECTION_DEFAULTS.restrictedUser,
    password,
    database: target.database,
    tenantSetting: env.LWQL_TENANT_SETTING ?? LWQL_CONNECTION_DEFAULTS.tenantSetting,
  };
}

/** The credential-free ClickHouse target, or unavailable when it cannot be derived safely. */
export type LwqlClickHouseTarget =
  | { readonly available: false }
  | { readonly available: true; readonly url: string; readonly database: string };

/** A stores-supplied target, refused where an explicit LWQL_* override disagrees with it. */
export function applyLwqlTargetOverrides({
  target,
  explicitUrl,
  explicitDatabase,
}: {
  target: Readonly<{ url: string; database: string }>;
  explicitUrl: string | undefined;
  explicitDatabase: string | undefined;
}): LwqlClickHouseTarget {
  if (disagreesWithDerivedServer({ explicitUrl, derivedOrigin: new URL(target.url).origin })) {
    return { available: false };
  }
  if (explicitDatabase && explicitDatabase !== target.database) {
    logger.error(
      { lwqlDatabase: explicitDatabase, adminDatabase: target.database },
      "LangWatchQL: LWQL_DATABASE cannot name a database other than CLICKHOUSE_URL's own — the key-map row policies and the key-map backfill would disagree. Unset LWQL_DATABASE so it derives from CLICKHOUSE_URL",
    );
    return { available: false };
  }
  return { available: true, url: target.url, database: target.database };
}
