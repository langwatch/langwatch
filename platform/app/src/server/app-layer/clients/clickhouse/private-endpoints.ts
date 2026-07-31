/**
 * Organisations pinned to their own ClickHouse endpoint, declared by env var.
 *
 * Env var format: `CLICKHOUSE_URL__<label>__<orgId>=<connectionUrl>`. The
 * `<label>` is a human-readable customer name, ignored by code; the `<orgId>`
 * is the organisation id routing keys on. Parsed once at module load, so
 * resolution costs no database query and no decryption.
 *
 * Moved here verbatim from the driver-based `~/server/clickhouse/clickhouseClient.ts`
 * when routing became a property of the client's router rather than of a
 * separately-constructed client object (ADR-104 §4). Behaviour is unchanged,
 * including the refusal to accept two env vars naming the same organisation:
 * silently picking one of two conflicting endpoints for a tenant is how a
 * deployment reads one customer's data from another customer's server.
 */

import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:clickhouse:routing");

const PRIVATE_CH_ENV_PREFIX = "CLICKHOUSE_URL__";

export function parsePrivateClickHouseUrls(
  env: NodeJS.ProcessEnv = process.env,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();

  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(PRIVATE_CH_ENV_PREFIX)) continue;

    if (!value || value.trim() === "") {
      logger.warn(
        { envVar: key },
        "Skipping private ClickHouse env var: empty value",
      );
      continue;
    }

    // Strip the prefix, then take the last `__`-separated segment as the org id.
    const suffix = key.slice(PRIVATE_CH_ENV_PREFIX.length);
    const lastSeparator = suffix.lastIndexOf("__");
    const organizationId =
      lastSeparator >= 0 ? suffix.slice(lastSeparator + 2) : suffix;

    if (!organizationId) continue;

    if (map.has(organizationId)) {
      throw new Error(
        `Duplicate private ClickHouse config for orgId "${organizationId}": env var "${key}" conflicts with an earlier definition.`,
      );
    }

    map.set(organizationId, value);
    logger.info(
      { orgId: organizationId, envVar: key },
      "Loaded private ClickHouse URL from env var",
    );
  }

  if (map.size > 0) {
    logger.info({ count: map.size }, "Private ClickHouse instances configured");
  }

  return map;
}
