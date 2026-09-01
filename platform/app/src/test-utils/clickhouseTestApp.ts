import { SettingsMap, type ClickHouseClient, type ClickHouseSettings } from "@clickhouse/client";
import { ClickHouseBillingAdapter } from "~/runtime/app/features/billing";
import { AppGovernanceRuntime } from "@langwatch/enterprise-api/governance/runtime";
import { AppGovernanceEventingAdapter } from "@langwatch/enterprise-api/governance/governance-eventing.adapter";
import { BudgetOverviewService } from "~/server/gateway/budgetOverview.service";
import { AppIngestionSourceAdapter } from "@langwatch/enterprise-api/governance/ingestion-source.adapter";
import { AppIngestionSourceActivityAdapter } from "@langwatch/enterprise-api/governance/ingestion-source-activity.adapter";
import { FREE_PLAN } from "@langwatch/enterprise-licensing-contract";
import { AppGovernanceOcsfEventsAdapter } from "@langwatch/enterprise-api/governance/governance-ocsf-events.adapter";
import { AppGovernanceTraceActivityAdapter } from "@langwatch/enterprise-api/governance/governance-trace-activity.adapter";
import { AppPersonalUsageReadAdapter } from "@langwatch/enterprise-api/governance/personal-usage-read.adapter";
import {
  WebhookEventsAdapter,
  WebhookEventsService,
} from "~/runtime/app/features/webhooks";
import type { RedisConnection } from "@langwatch/redis-client";
import {
  AppEvaluationExecutionPort,
  AppEvaluationRuntime,
} from "~/runtime/app/features/evaluation";
import { createRetentionFloorService } from "~/server/app-layer/clients/clickhouse/retention-floor";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { decrypt, encrypt } from "~/utils/encryption";
import { modelProviders as modelProviderRegistry } from "@langwatch/model-provider-contract";
import { resolveOrgAdminEmail } from "~/server/organizations/resolveOrgAdminEmail";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";

type ClickHouseClientLike = ClickHouseClient;

import { GatewayBudgetLedgerAdapter } from "@langwatch/gateway-server";
import {
  GatewaySpendEventsClickHouseAdapter,
  GatewaySpendEventsService,
} from "@langwatch/gateway-server";
import { GatewayVirtualKeySpendAdapter } from "@langwatch/gateway-server";
import type { GatewayClickHouseClient, GatewayClickHouseResolver } from "@langwatch/gateway-server";

type GatewaySettingsInput = Record<
  string,
  string | number | boolean | Record<string, string | number | boolean> | undefined
>;

class TestGatewayClickHouseClient implements GatewayClickHouseClient {
  static create(client: ClickHouseClient): TestGatewayClickHouseClient {
    return new TestGatewayClickHouseClient(client);
  }

  private constructor(private readonly client: ClickHouseClient) {}

  async query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: GatewaySettingsInput;
  }): Promise<{ json<T = unknown>(): Promise<T[]> }> {
    const settings = testGatewaySettings(input.clickhouse_settings);
    const result = await this.client.query({
      query: input.query,
      query_params: input.query_params,
      format: input.format,
      ...(settings === undefined ? {} : { clickhouse_settings: settings }),
    });
    return {
      json: async <Result = unknown>(): Promise<Result[]> => result.json<Result>(),
    };
  }

  async insert(input: {
    table: string;
    values: Record<string, unknown>[];
    format?: "JSONEachRow";
    clickhouse_settings?: GatewaySettingsInput;
  }): Promise<void> {
    const settings = testGatewaySettings(input.clickhouse_settings);
    await this.client.insert({
      table: input.table,
      values: input.values,
      format: input.format,
      ...(settings === undefined ? {} : { clickhouse_settings: settings }),
    });
  }
}

function testGatewaySettings(
  input: GatewaySettingsInput | undefined,
): ClickHouseSettings | undefined {
  if (input === undefined) return undefined;
  const settings: ClickHouseSettings = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || typeof value !== "object") settings[key] = value;
    else {
      const entries = Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        String(nestedValue),
      ]);
      settings[key] = SettingsMap.from(Object.fromEntries(entries));
    }
  }
  return settings;
}

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
  resolveOrganizationClient?: (organizationId: string) => Promise<ClickHouseClientLike | null>;
  /**
   * The connection routes under test read as `getApp().redis` (ADR-093).
   * Defaults to none, which is right for a test that asserts only on rows; a
   * test whose route needs Redis passes the one it already opened.
   */
  redis?: RedisConnection | null;
}) {
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
      throw new Error(`Test ClickHouse not available for organization ${organizationId}`);
    }
    return client;
  };
  const requiredGateway: GatewayClickHouseResolver = async (tenantId) => {
    return TestGatewayClickHouseClient.create(await required(tenantId));
  };

  const governanceTraceActivity = new AppGovernanceTraceActivityAdapter(required);
  const governanceOcsfEvents = new AppGovernanceOcsfEventsAdapter(required);
  const personalUsage = new AppPersonalUsageReadAdapter(required);
  const baseApp = createTestApp();
  const governanceVirtualKeys = baseApp.gatewayStores.virtualKeys;
  const governanceOptions = {
    organizations: baseApp.organizationService,
    projects: baseApp.projects.projectService,
    apiKeys: baseApp.apiKeys.apiKeyService,
    gatewayBaseUrl: "http://localhost:5563",
    setupActivity: governanceTraceActivity,
    ocsfEvents: governanceOcsfEvents,
    personalUsage,
    virtualKeys: governanceVirtualKeys,
    budgetOverview: BudgetOverviewService.create({
      database: prisma,
      organizations: baseApp.organizationService,
      featureFlags: baseApp.featureFlags,
      personalVirtualKeys: governanceVirtualKeys,
      personalUsage,
      budgetDecisions: baseApp.gatewayStores.budgetDecisions,
    }),
    providers: {
      list: () =>
        Object.entries(modelProviderRegistry).map(([providerKey, provider]) => ({
          providerKey,
          displayName: provider.name,
          type: provider.type,
        })),
    },
    contacts: {
      tryResolveAdminEmail: (organizationId: string) =>
        resolveOrgAdminEmail({ prisma, organizationId }),
    },
  };
  const ingestionSources = AppIngestionSourceAdapter.create({
    plans: { getActivePlan: async () => FREE_PLAN },
    lifecycle: { sync: async () => undefined },
    secretPepper: "test-ingestion-secret-pepper",
    encryption: { encrypt, decrypt },
  });
  const activity = AppIngestionSourceActivityAdapter.create({
    database: prisma,
    resolveClient: requiredOrg,
  }).clickhouse();
  const governance = AppGovernanceRuntime.create(prisma, {
    ...governanceOptions,
    eventing: AppGovernanceEventingAdapter.noopGovernancePort(),
    activityClickhouse: activity,
    ingestionSourceEntitlements: ingestionSources.entitlements(),
    ingestionSourceLifecycle: ingestionSources.lifecycle(),
    ingestionEncryption: ingestionSources.encryption(),
    ingestionSecretPepper: ingestionSources.secretPepper(),
    ingestionDiagnostics: ingestionSources.diagnostics(),
  });
  const evaluations = AppEvaluationRuntime.create({
    resolveClickHouse: async (tenantId) => {
      const client = await required(tenantId);
      return {
        insert: (input) => client.insert(input as never),
        query: async (input) => {
          const result = await client.query(input as never);
          return {
            json: async <Result>() => (await result.json<Result>()) as unknown as Result[],
          };
        },
      };
    },
    retentionFloor: createRetentionFloorService(baseApp.dataRetention),
    execution: AppEvaluationExecutionPort.create(async () => ({
      status: "skipped",
    })),
    workflows: baseApp.workflows.workflowService,
    featureFlags: baseApp.featureFlags,
    storedObjects: baseApp.storedObjects,
    inputsOffloadConfig: baseApp.config.evaluationInputsOffload,
  }).build();

  const app = createTestApp({
    clickhouse: {
      enabled: true,
      resolveClient: required,
      resolveOrganizationClient: requiredOrg,
      allInstances: async () => [],
    },
    redis: redis ?? null,
    gateway: {
      ...baseApp.gatewayStores,
      budgets: GatewayBudgetLedgerAdapter.create(requiredGateway),
      virtualKeySpend: GatewayVirtualKeySpendAdapter.create(requiredGateway),
      spendEvents: GatewaySpendEventsService.create(
        GatewaySpendEventsClickHouseAdapter.create(requiredGateway),
      ),
      webhookEvents: WebhookEventsService.create({
        prisma,
        repository: WebhookEventsAdapter.create(required),
      }),
    },
    governance,
    organizations: baseApp.organizationService,
    projects: baseApp.projects.projectService,
    billableEvents: ClickHouseBillingAdapter.create({
      resolveClient: required,
      resolveOrganizationClient: requiredOrg,
    }).build(),
    evaluations,
  });
  globalForApp.__langwatch_app = app;
  return app;
}

/** Drops the singleton this installed. Pair with it in `afterAll`. */
export async function clearClickHouseTestApp(): Promise<void> {
  await resetApp();
}
