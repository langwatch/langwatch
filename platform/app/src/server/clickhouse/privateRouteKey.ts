/**
 * Reading a private ClickHouse route out of its environment variable name.
 *
 * Its own module, and not a helper inside `clickhouseClient.ts`, because that
 * module imports Prisma: splitting a string should not need a database client
 * to test, and a test that has to generate the Prisma client first is a test
 * nobody runs.
 */

/** Env var format: `CLICKHOUSE_URL__<label>__<orgId>=<connectionUrl>`. */
export const PRIVATE_CH_ENV_PREFIX = "CLICKHOUSE_URL__";

export interface PrivateRoute {
  /** The organization whose traffic goes to this cluster. */
  orgId: string;
  /**
   * The name a human calls this cluster, from the `<label>` segment.
   *
   * This used to be parsed and thrown away — the format was documented as
   * "<label> is a human-readable customer name, ignored by code". It is the
   * only human-readable name the platform has for a customer's dedicated
   * ClickHouse, and discarding it had a cost: when a private instance rejected
   * ~5.6k statements in three hours on 2026-08-13, no log line said which
   * cluster had refused them, and identifying it meant reading a concurrency
   * limit out of the vendor's error text and matching it against terraform.
   */
  cluster: string;
}

/**
 * Split the variable name into the org it routes and the cluster's name.
 * Returns null when there is no org id, which is the only part that must exist.
 */
export function parseRouteKey({
  key,
  prefix = PRIVATE_CH_ENV_PREFIX,
}: {
  key: string;
  prefix?: string;
}): PrivateRoute | null {
  // The org id is the LAST "__"-separated segment, not the first. A label is
  // free text somebody wrote and may itself contain the separator, while an org
  // id never does — splitting on the first would route "acme__eu" to org "eu".
  const suffix = key.slice(prefix.length);
  const lastSep = suffix.lastIndexOf("__");
  const orgId = lastSep >= 0 ? suffix.slice(lastSep + 2) : suffix;
  if (!orgId) return null;

  // Falls back to the org id so the field is never empty: an operator reading
  // an error needs *a* name, and an unlabelled variable still describes a
  // different cluster from the shared one. `> 0` rather than `>= 0` so a
  // leading separator reads as unlabelled instead of as an empty name.
  const cluster = (lastSep > 0 ? suffix.slice(0, lastSep) : "") || orgId;
  return { orgId, cluster };
}
