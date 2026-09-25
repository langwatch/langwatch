import { EventEmitter } from "node:events";

import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import {
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { HandledError } from "@langwatch/handled-error";
import type { ResourceOwnership } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { Encryption } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import { type SimulationService } from "@langwatch/scenario-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import {
  scenarioExecutorPeers,
  scenarioHostMembers,
  scenarioTestConfig,
} from "../../__tests__/support/scenario-app-setup.fixture.ts";
import type { ScenarioReadOnlyClickHouse, ScenarioTabStore } from "../../app/scenario.app.ts";
import { ScenarioApp } from "../../app/scenario.app.ts";
import type { ScenarioEventBroadcastPublisher } from "../../channels/redis/redis.scenario-event-broadcast.channel.ts";
import { MemoryScenarioRepositories } from "../../repositories/memory/memory.scenario.repositories.ts";

export const PROJECT_ID = "project_scenario_rest";
export const PROJECT_SLUG = "scenario-rest-project";
export const ORGANIZATION_ID = "organization_scenario_rest";

export function createScenarioRestTestApp(
  options: {
    simulations?: Partial<SimulationService>;
    tabs?: Partial<ScenarioTabStore>;
    redis?: Partial<ScenarioEventBroadcastPublisher>;
    traces?: Partial<TraceApi>;
    billing?: Partial<BillingApi>;
    plans?: Partial<EntitlementApi>;
    featureFlags?: Partial<FeatureFlagApi>;
    projects?: Partial<ProjectApi>;
  } = {},
) {
  const simulations = createApiFixture<SimulationService>(
    options.simulations ?? {},
    "Simulation service",
  );
  const redis = createApiFixture<ScenarioEventBroadcastPublisher>(options.redis ?? {}, "Redis");

  const app = ScenarioApp.create({
    repositories: {
      ...MemoryScenarioRepositories.create(),
      ...(options.tabs
        ? { tabs: createApiFixture<ScenarioTabStore>(options.tabs, "Tab store") }
        : {}),
    },
    dependencies: {
      agents: createApiFixture<AgentApi>(),
      evaluations: createApiFixture<EvaluationApi>(),
      users: createApiFixture<UserApi>(),
      projects: createApiFixture<ProjectApi>(
        options.projects ?? { getOrganizationId: async () => ORGANIZATION_ID },
        "Project API",
      ),
      plans: createApiFixture<EntitlementApi>(
        options.plans ?? { assertWithinUsageLimit: async () => {} },
        "Entitlement API",
      ),
      modelProviders: createApiFixture<ModelProviderApi>(),
      presence: createApiFixture<PresenceApi>({
        getTenantEmitter: () => new EventEmitter(),
        cleanupTenantEmitter: () => {},
      }),
      auditLog: createApiFixture<AuditLogApi>(),
      traces: createApiFixture<TraceApi>(options.traces, "Trace API"),
      billing: createApiFixture<BillingApi>(options.billing ?? {}, "Billing API"),
      retention: createApiFixture<DataRetentionApi>(),
      suites: createApiFixture<SuiteApi>(),
      ...scenarioExecutorPeers(),
      featureFlags: createApiFixture<FeatureFlagApi>(
        options.featureFlags ?? { isEnabled: async () => false },
        "Feature flag API",
      ),
    },
    members: {
      ...scenarioHostMembers,
      clickhouse: createApiFixture<ScenarioReadOnlyClickHouse>(),
      redis,
      simulations,
      encryption: createApiFixture<Encryption>(),
      rateLimiter: { check: async () => ({ allowed: true }) },
      idempotency: { claim: async () => true },
      publicBaseUrl: "https://app.langwatch.test",
    },
    resources: createApiFixture<ResourceOwnership>(),
    config: scenarioTestConfig,
    secrets: {} as never,
  });

  return { app, simulations, redis };
}

export function createScenarioRestTestRuntime(
  options: {
    authenticated?: boolean;
    /**
     * Who the door names beyond "is there a request": defaults to a signed
     * in person. A legacy project key names none — pass `viewerUserId: null`
     * with an `actorId` that isn't a `User` row to exercise that case.
     */
    viewerUserId?: string | null;
    actorId?: string;
  } = {},
) {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        if (options.authenticated === false) {
          throw new HTTPException(401, { message: "Unauthenticated" });
        }

        return {
          actor: { type: "user" as const, id: "user_scenario_rest" },
          scope: { tier: "project" as const, id: PROJECT_ID },
        };
      },
    },
  });

  const projectFacts = bindRestMiddleware(projectRestFacts, () => ({
    projectSlug: PROJECT_SLUG,
    viewerUserId: options.viewerUserId === undefined ? "user_scenario_rest" : options.viewerUserId,
    actorId: options.actorId ?? "user_scenario_rest",
  }));

  return { runtime, projectFacts };
}

export const scenarioRestTestErrors: RestErrorHandler = (error, context) => {
  if (error instanceof HTTPException) return error.getResponse();

  if (HandledError.isHandled(error)) {
    return context.json(
      { error: error.code, message: error.message },
      (error.httpStatus ?? 500) as ContentfulStatusCode,
    );
  }

  return context.json({ error: "internal_server_error" }, 500);
};
