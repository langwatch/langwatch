import type { ClickHouseClient } from "@clickhouse/client";

import type { ClickHouseClientResolver } from "./clickhouseClient";

/** One resolved ClickHouse endpoint and the tenants that route to it. */
export interface TenantClientGroup {
  client: ClickHouseClient;
  tenantIds: string[];
}

/**
 * Group tenants by the ClickHouse endpoint each of them routes to.
 *
 * Routing is per-organization, so a list drawn from a single organization
 * collapses to one group and a multi-tenant read stays exactly one query.
 * Nothing in the type of a `tenantIds: string[]` parameter says the list may
 * not span organizations though, and reading them all through the first
 * tenant's client would silently answer with whatever subset that one endpoint
 * happens to hold. Grouping makes the fan-out follow the data instead of an
 * assumption a later caller has no way to see.
 *
 * Duplicates collapse, and groups come back in the order their first tenant
 * appeared, so a caller's result order is a function of its own input.
 */
export async function groupTenantsByClient({
  tenantIds,
  resolveClient,
}: {
  tenantIds: string[];
  resolveClient: ClickHouseClientResolver;
}): Promise<TenantClientGroup[]> {
  const groups = new Map<ClickHouseClient, TenantClientGroup>();
  for (const tenantId of new Set(tenantIds)) {
    const client = await resolveClient(tenantId);
    const group = groups.get(client);
    if (group) group.tenantIds.push(tenantId);
    else groups.set(client, { client, tenantIds: [tenantId] });
  }
  return [...groups.values()];
}
