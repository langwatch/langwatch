import type { ClickHouseClient } from "@clickhouse/client";
import { BillableEventsClickHouseRepository } from "@ee/billing/services/billableEvents.clickhouse.repository";
import { ActivityMonitorClickHouseRepository } from "@ee/governance/services/activity-monitor/activityMonitor.clickhouse.repository";
import { GovernanceCostRollupClickHouseRepository } from "@ee/governance/services/governanceCostRollup.clickhouse.repository";
import { GovernanceKpisClickHouseRepository } from "@ee/governance/services/governanceKpis.clickhouse.repository";
import { GovernanceOcsfEventsClickHouseRepository } from "@ee/governance/services/governanceOcsfEvents.clickhouse.repository";
import { GovernanceTraceActivityClickHouseRepository } from "@ee/governance/services/governanceTraceActivity.clickhouse.repository";
import { PersonalUsageClickHouseRepository } from "@ee/governance/services/personalUsage.clickhouse.repository";
import { WebhookEventsClickHouseRepository } from "@ee/webhooks/webhookEvents.clickhouse.repository";
import type { RedisConnection } from "@langwatch/redis-client";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";

type ClickHouseClientLike = ClickHouseClient;

import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { GatewaySpendEventsRepository } from "~/server/gateway/spendEvents.clickhouse.repository";
import { GatewayVirtualKeySpendRepository } from "~/server/gateway/virtualKeySpend.clickhouse.repository";

/**
 * Installs an App singleton whose ClickHouse-backed repositories are real and
 * point at the test's own ClickHouse.
 *
 * Integration tests that drive a route or worker end-to-end need this because
 * of the access rule: those paths no longer resolve a client of their own, they
 * take a repository from `getApp()`. With no App they fail with "App not
 * initialized", which looks like a bug in the route and is really a bug in the
 * fixture.
 *
 * `createTestApp` alone is not enough - its ClickHouse slots are null, which is
 * right for a unit test and useless for one that asserts on rows.
 *
 * Wires the ClickHouse-backed slots a route or worker test reaches today:
 * `clickhouse`, `gateway`, `governance` (including ADR-128's cost rollup) and
 * `billableEvents`. The rest keep
 * their `createTestApp` defaults - a throwing analytics resolver, a null
 * filter repository, an empty cross-tenant stored-object lookup, no orphan
 * reconciliation. A test whose route reaches one of those adds it here rather
 * than resolving a client of its own.
 */
export function installClickHouseTestApp({
  resolveClient,
  resolveOrganizationClient,
  redis,
}: {
  /**
   * Per-tenant resolver, usually a closure over the test's container client.
   * Allowed to answer null - the container helpers do - and wrapped here into
   * the throws-if-unavailable contract the repositories expect, so no fixture
   * has to repeat that check.
   */
  resolveClient: (tenantId: string) => Promise<ClickHouseClientLike | null>;
  /**
   * Per-organization resolver, for the repositories that roll up across an
   * org's projects rather than reading one tenant. Defaults to
   * `resolveClient`, which is correct whenever the test has a single
   * ClickHouse behind both.
   */
  resolveOrganizationClient?: (
    organizationId: string,
  ) => Promise<ClickHouseClientLike | null>;
  /**
   * The connection routes under test read as `getApp().redis` (ADR-093).
   * Defaults to none, which is right for a test that asserts only on rows; a
   * test whose route needs Redis passes the one it already opened.
   */
  redis?: RedisConnection | null;
}): void {
  const required: ClickHouseClientResolver = async (tenantId) => {
    const client = await resolveClient(tenantId);
    if (!client) {
      throw new Error(`Test ClickHouse not available for tenant ${tenantId}`);
    }
    return client;
  };
  const orgSource = resolveOrganizationClient ?? resolveClient;
  const requiredOrg = async (organizationId: string) => {
    const client = await orgSource(organizationId);
    if (!client) {
      throw new Error(
        `Test ClickHouse not available for organization ${organizationId}`,
      );
    }
    return client;
  };

  globalForApp.__langwatch_app = createTestApp({
    clickhouse: {
      enabled: true,
      resolveClient: required,
      resolveOrganizationClient: requiredOrg,
      allInstances: async () => [],
    },
    redis: redis ?? null,
    gateway: {
      budgets: new GatewayBudgetClickHouseRepository(required),
      virtualKeySpend: new GatewayVirtualKeySpendRepository(required),
      spendEvents: new GatewaySpendEventsRepository(required),
      webhookEvents: new WebhookEventsClickHouseRepository(required),
    },
    governance: {
      ocsfEvents: new GovernanceOcsfEventsClickHouseRepository(required),
      traceActivity: new GovernanceTraceActivityClickHouseRepository(required),
      kpis: new GovernanceKpisClickHouseRepository(required),
      personalUsage: new PersonalUsageClickHouseRepository(required),
      activityMonitor: new ActivityMonitorClickHouseRepository(required),
      costRollup: new GovernanceCostRollupClickHouseRepository(required),
      // The erasure needs Postgres repositories and the ops replay service,
      // neither of which this ClickHouse-only harness composes. A suite that
      // drives an erasure builds it directly.
      identityErasure: undefined,
    },
    billableEvents: new BillableEventsClickHouseRepository(
      required,
      requiredOrg,
    ),
  });
}

/** Drops the singleton this installed. Pair with it in `afterAll`. */
export async function clearClickHouseTestApp(): Promise<void> {
  await resetApp();
}
