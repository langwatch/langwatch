/**
 * Main's per-organization ClickHouse family, `CLICKHOUSE_URL__<label>__<orgId>=<url>`, parsed once
 * at boot from the stores' secret family (ARCHITECTURE.md §7). Each URL carries credentials: a
 * refusal names the variable, never its value.
 */
import { parseRoutingTable } from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";

import type { ClickHousePrivateRoute } from "./config.ts";

const logger = createLogger("langwatch:stores:clickhouse-routes");

/** Each organization's own server, from the resolved family; an unusable entry is skipped. */
export function clickhouseRoutesOf(
  family: ReadonlyMap<string, string>,
): readonly ClickHousePrivateRoute[] {
  const table = parseRoutingTable(Object.fromEntries(family));

  for (const { envVar, reason } of table.skipped) {
    logger.warn({ envVar, reason }, "ClickHouse private route skipped");
  }
  for (const { envVar, organizationId } of table.ambiguous) {
    logger.warn({ envVar, organizationId }, "ClickHouse private route name is ambiguous");
  }

  return [...table.routes].map(([organizationId, url]) => ({ organizationId, url }));
}
