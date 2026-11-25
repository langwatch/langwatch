/**
 * Main's per-organization ClickHouse family, `CLICKHOUSE_URL__<label>__<orgId>=<url>`, parsed once
 * at boot from the stores' secret family (ARCHITECTURE.md §7). Each URL carries credentials: a
 * refusal names the variable, never its value.
 */
import {
  parseRoutingTable,
  PRIVATE_ROUTE_ENV_PREFIX,
  privateRouteNameOf,
} from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";

import type { ClickHousePrivateRoute, MalformedPrivateVariable } from "./config.ts";

const logger = createLogger("langwatch:stores:clickhouse-routes");

/** Each organization's own server, and the variables present but unusable, from the family. */
export function clickhouseRouteFamilyOf(family: ReadonlyMap<string, string>): {
  routes: readonly ClickHousePrivateRoute[];
  malformed: readonly MalformedPrivateVariable[];
} {
  const table = parseRoutingTable(Object.fromEntries(family));

  for (const { envVar, reason } of table.skipped) {
    logger.warn({ envVar, reason }, "ClickHouse private route skipped");
  }
  for (const { envVar, organizationId } of table.ambiguous) {
    logger.warn({ envVar, organizationId }, "ClickHouse private route name is ambiguous");
  }

  const labelOf = (variable: string) =>
    privateRouteNameOf({ prefix: PRIVATE_ROUTE_ENV_PREFIX, variable }).label;
  const routes = [...table.routes].map(([organizationId, url]) => {
    const variable = table.variables?.get(organizationId);
    return variable === undefined
      ? { organizationId, url }
      : { organizationId, url, variable, label: labelOf(variable) };
  });
  const malformed = [...(table.malformed ?? [])].map(([organizationId, variable]) => ({
    organizationId,
    variable,
    label: labelOf(variable),
  }));
  return { routes, malformed };
}

/** Each organization's own server, from the resolved family; an unusable entry is skipped. */
export function clickhouseRoutesOf(
  family: ReadonlyMap<string, string>,
): readonly ClickHousePrivateRoute[] {
  return clickhouseRouteFamilyOf(family).routes;
}
