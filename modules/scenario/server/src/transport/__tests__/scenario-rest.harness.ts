import { EventEmitter } from "node:events";

import type { AgentApi } from "@langwatch/agent-contract";
import {
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { HandledError } from "@langwatch/handled-error";
import type { Encryption } from "@langwatch/process-stores/members";
import type { ResourceOwnership } from "@langwatch/kernel";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  type ScenarioExecutionService,
  type ScenarioTabRegistry,
  type SimulationService,
} from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type {
  AgentAdapterFactory,
  CancellationPublisher,
  CancellationSubscriber,
  ScenarioChildBootstrap,
  ScenarioChildExecutionSession,
  ScenarioExecutionPool,
  ScenarioExecutionRunner,
  ScenarioHttp,
  ScenarioProcessorServiceMetrics,
  ScenarioTabStore,
} from "../../app/scenario.app.ts";
import { ScenarioApp } from "../../app/scenario.app.ts";
import { MemoryScenarioRepositories } from "../../repositories/memory/memory.scenario.repositories.ts";
import type { AgentTestService } from "../../services/agent-test.service.ts";
import type { ResultAtomsService } from "../../services/result-atoms.service.ts";
import type { RunConfigurationsService } from "../../services/run-configurations.service.ts";

export const PROJECT_ID = "project_scenario_rest";
export const PROJECT_SLUG = "scenario-rest-project";

export function createScenarioRestTestApp(
  options: {
    simulations?: Partial<SimulationService>;
    scenarioTabs?: Partial<ScenarioTabRegistry>;
  } = {},
) {
  const simulations = createApiFixture<SimulationService>(
    options.simulations ?? {},
    "Simulation service",
  );
  const scenarioTabs = createApiFixture<ScenarioTabRegistry>(
    options.scenarioTabs ?? {},
    "Scenario tab registry",
  );

  const app = ScenarioApp.create({
    repositories: MemoryScenarioRepositories.create(),
    dependencies: {
      agents: createApiFixture<AgentApi>(),
      users: createApiFixture<UserApi>(),
      projects: createApiFixture<ProjectApi>(),
      plans: createApiFixture<EntitlementApi>(),
    },
    members: {
      agentTesting: createApiFixture<AgentTestService>(),
      simulations,
      scenarioExecution: createApiFixture<ScenarioExecutionService>(),
      scenarioTabs,
      broadcast: { getTenantEmitter: () => new EventEmitter() },
      resultAtoms: createApiFixture<ResultAtomsService>(),
      runConfigurations: createApiFixture<RunConfigurationsService>(),
      agentAdapterFactory: createApiFixture<AgentAdapterFactory>(),
      cancellationPublisher: createApiFixture<CancellationPublisher>(),
      cancellationSubscriber: createApiFixture<CancellationSubscriber>(),
      scenarioChildBootstrap: createApiFixture<ScenarioChildBootstrap>(),
      scenarioChildExecutionSession: createApiFixture<ScenarioChildExecutionSession>(),
      scenarioExecutionPool: createApiFixture<ScenarioExecutionPool>(),
      scenarioExecutionRunner: createApiFixture<ScenarioExecutionRunner>(),
      scenarioHttp: createApiFixture<ScenarioHttp>(),
      scenarioProcessorServiceMetrics: createApiFixture<ScenarioProcessorServiceMetrics>(),
      scenarioTabStore: createApiFixture<ScenarioTabStore>(),
      encryption: createApiFixture<Encryption>(),
      rateLimiter: { check: async () => ({ allowed: true }) },
    },
    resources: createApiFixture<ResourceOwnership>(),
    config: { publicBaseUrl: "https://app.langwatch.test" },
  });

  return { app, simulations, scenarioTabs };
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
