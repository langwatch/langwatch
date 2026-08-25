import type { ClickHouseClient } from "@clickhouse/client";
import { ClickHouseBillingAdapter } from "~/runtime/app/features/billing";
import { AppGovernanceRuntime } from "~/runtime/app/features/governance";
import { AppIngestionSourceAdapter } from "~/runtime/app/features/governance/ingestion-source.adapter";
import { AppIngestionSourceActivityAdapter } from "~/runtime/app/features/governance/ingestion-source-activity.adapter";
import { FREE_PLAN } from "@langwatch/enterprise-licensing-contract";
import { GovernanceKpisClickHouseRepository } from "~/runtime/app/features/governance/governance-kpis.clickhouse.repository";
import { GovernanceOcsfEventsClickHouseRepository } from "~/runtime/app/features/governance/governance-ocsf-events.clickhouse.repository";
import { GovernanceTraceActivityClickHouseRepository } from "~/runtime/app/features/governance/governance-trace-activity.clickhouse.repository";
import { PersonalUsageClickHouseRepository } from "~/runtime/app/features/governance/personal-usage.clickhouse.repository";
import { WebhookEventsClickHouseRepository } from "~/runtime/app/features/webhooks";
import type { RedisConnection } from "@langwatch/redis-client";
import {
  AppEvaluationExecutionPort,
  AppEvaluationRuntime,
} from "~/runtime/app/features/evaluation";
import { createRetentionFloorService } from "~/server/app-layer/clients/clickhouse/retention-floor";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
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
 * `clickhouse`, `gateway`, `governance` and `billableEvents`. The rest keep
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

  const governanceTraceActivity =
    new GovernanceTraceActivityClickHouseRepository(required);
  const governanceOcsfEvents =
    new GovernanceOcsfEventsClickHouseRepository(required);
  const personalUsage = new PersonalUsageClickHouseRepository(required);
  const baseApp = createTestApp();
  const governanceRuntime = AppGovernanceRuntime.create(prisma, {
    organizations: baseApp.organizations,
    projects: baseApp.projects,
    gatewayBaseUrl: "http://localhost:5563",
    setupActivity: governanceTraceActivity,
    ocsfEvents: governanceOcsfEvents,
    personalUsage,
  });
  const ingestionSources = AppIngestionSourceAdapter.create({
    database: prisma,
    projects: governanceRuntime.projects,
    plans: { getActivePlan: async () => FREE_PLAN },
    lifecycle: { sync: async () => undefined },
    secretPepper: "test-ingestion-secret-pepper",
  }).build();
  const activity = AppIngestionSourceActivityAdapter.create({
    database: prisma,
    resolveClient: requiredOrg,
  }).build();
  const evaluations = AppEvaluationRuntime.create({
    resolveClickHouse: async (tenantId) => {
      const client = await required(tenantId);
      return {
        insert: (input) => client.insert(input as never),
        query: async (input) => {
          const result = await client.query(input as never);
          return {
            json: async <Result>() =>
              (await result.json<Result>()) as unknown as Result[],
          };
        },
      };
    },
    retentionFloor: createRetentionFloorService(baseApp.retentionPolicyCache),
    execution: AppEvaluationExecutionPort.create(async () => ({
      status: "skipped",
    })),
    workflows: baseApp.workflows,
  }).build();

  globalForApp.__langwatch_app = createTestApp({
    clickhouse: {
      enabled: true,
      resolveClient: required,
      resolveOrganizationClient: requiredOrg,
      allInstances: async () => [],
    },
    redis: redis ?? null,
    gateway: {
      ...baseApp.gateway,
      budgets: new GatewayBudgetClickHouseRepository(required),
      virtualKeySpend: new GatewayVirtualKeySpendRepository(required),
      spendEvents: new GatewaySpendEventsRepository(required),
      webhookEvents: WebhookEventsClickHouseRepository.create(required),
    },
    governance: {
      ...baseApp.governance,
      activity,
      ingestionTemplates: governanceRuntime.ingestionTemplates,
      ingestionSources,
      setupState: governanceRuntime.setupState,
      ocsfExport: governanceRuntime.ocsfExport,
      ottlGateway: governanceRuntime.ottlGateway,
      canonicalCostExtractor: governanceRuntime.canonicalCostExtractor,
      ocsfEvents: governanceOcsfEvents,
      traceActivity: governanceTraceActivity,
      kpis: new GovernanceKpisClickHouseRepository(required),
      personalUsage: governanceRuntime.personalUsage,
    },
    organizations: baseApp.organizations,
    projects: baseApp.projects,
    billableEvents: ClickHouseBillingAdapter.create({
      resolveClient: required,
      resolveOrganizationClient: requiredOrg,
    }).build(),
    evaluations,
  });
}

/** Drops the singleton this installed. Pair with it in `afterAll`. */
export async function clearClickHouseTestApp(): Promise<void> {
  await resetApp();
}
