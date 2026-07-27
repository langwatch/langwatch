/**
 * The single construction point for the gateway's ClickHouse-backed
 * repositories, shared by the tRPC routers and the public REST API.
 *
 * Detection is the presence of a configured ClickHouse endpoint. Both
 * surfaces MUST build their services through these helpers: constructing
 * `GatewayBudgetService.create(prisma)` bare on one surface while the
 * other passes the repo is how REST came to serve stale PG spend for the
 * same budgets the UI showed live (issue #6248).
 */
import {
  getClickHouseClientForProject,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";

import { GatewayBudgetClickHouseRepository } from "./budget.clickhouse.repository";
import { GatewayVirtualKeySpendRepository } from "./virtualKeySpend.clickhouse.repository";

async function resolveClient(projectId: string) {
  const client = await getClickHouseClientForProject(projectId);
  if (!client) {
    throw new Error(`ClickHouse enabled but no client for project ${projectId}`);
  }
  return client;
}

/** Budget-ledger repository, or undefined on deploys without ClickHouse. */
export function chRepoOrUndefined():
  | GatewayBudgetClickHouseRepository
  | undefined {
  if (!isClickHouseEnabled()) return undefined;
  return new GatewayBudgetClickHouseRepository(resolveClient);
}

/** Per-key cost-path spend repository, or undefined without ClickHouse. */
export function spendRepoOrUndefined():
  | GatewayVirtualKeySpendRepository
  | undefined {
  if (!isClickHouseEnabled()) return undefined;
  return new GatewayVirtualKeySpendRepository(resolveClient);
}
