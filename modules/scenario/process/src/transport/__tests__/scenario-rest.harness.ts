import { EventEmitter } from "node:events";

import type { AgentApi } from "@langwatch/agent-contract";
import {
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  UnauthorizedError,
} from "@langwatch/api/rest";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { ResourceOwnership } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { type SimulationService } from "@langwatch/scenario-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";

import {
  scenarioExecutorPeers,
  scenarioTestSecrets,
  scenarioVoicePeers,
  scenarioTestConfig,
} from "../../__tests__/support/scenario-app-setup.fixture.ts";
import {
  simulationRepositoryOver,
  simulationSendersOver,
} from "../../__tests__/support/simulation-service-fake.fixture.ts";
import { ScenarioModule, type ScenarioTabStore } from "../../app/scenario.app.ts";
import { MemoryScenarioRepositories } from "../../repositories/memory/memory.scenario.repositories.ts";

export const PROJECT_ID = "project_scenario_rest";
export const PROJECT_SLUG = "scenario-rest-project";
export const ORGANIZATION_ID = "organization_scenario_rest";

export async function createScenarioRestTestApp(
  options: {
    simulations?: Partial<SimulationService>;
    tabs?: Partial<ScenarioTabStore>;
    presence?: Partial<PresenceApi>;
    traces?: Partial<TraceApi>;
    plans?: Partial<EntitlementApi>;
    featureFlags?: Partial<FeatureFlagApi>;
    projects?: Partial<ProjectApi>;
  } = {},
) {
  const simulations = options.simulations ?? {};

  const app = await ScenarioModule.create({
    repositories: {
      ...MemoryScenarioRepositories.create(),
      simulations: simulationRepositoryOver(simulations),
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
        ...options.presence,
      }),
      auditLog: createApiFixture<AuditLogApi>(),
      traces: createApiFixture<TraceApi>(options.traces, "Trace API"),
      retention: createApiFixture<DataRetentionApi>(),
      suites: createApiFixture<SuiteApi>(),
      ...scenarioExecutorPeers(),
      ...scenarioVoicePeers(),
      featureFlags: createApiFixture<FeatureFlagApi>(
        options.featureFlags ?? { isEnabled: async () => false },
        "Feature flag API",
      ),
    },
    resources: createApiFixture<ResourceOwnership>(),
    config: { ...scenarioTestConfig, publicBaseUrl: "https://app.langwatch.test" },
    secrets: scenarioTestSecrets,
  });

  app.connectSimulationCommands(simulationSendersOver(simulations));

  return { app };
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
          throw new UnauthorizedError("Unauthenticated");
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
