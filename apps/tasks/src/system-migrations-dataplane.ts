/**
 * Which organizations the migration pass treats as private: the stores' own parse of main's
 * `CLICKHOUSE_URL__` family, resolved through the chain (ARCHITECTURE.md §7), never the env.
 */
import {
  type OrganizationDataplaneResolver,
  RoutingTableOrganizationDataplaneService,
} from "@langwatch/ops-process";
import { clickhouseRoutesOf } from "@langwatch/process-stores";
import type { ScopedSecrets } from "@langwatch/secrets";

import { tasksSecrets } from "./config.ts";

/** Which server each organization's rows live on, as the system migration pass reads it. */
export type SystemMigrationsDataplane = OrganizationDataplaneResolver;

/** The routes are spent inside the closure; only the dataplane answer escapes. */
export function openSystemMigrationsDataplane(
  secrets: ScopedSecrets,
): Promise<SystemMigrationsDataplane> {
  return secrets.into(tasksSecrets.clickhouseRoutes, (family) =>
    RoutingTableOrganizationDataplaneService.create({
      routes: new Map(clickhouseRoutesOf(family).map((route) => [route.organizationId, route.url])),
    }),
  );
}
