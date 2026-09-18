import { EventEmitter } from "node:events";

import type { AgentApi } from "@langwatch/agent-contract";
import {
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { HandledError } from "@langwatch/handled-error";
import type { ResourceOwnership } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { Encryption } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  type ScenarioExecutionService,
  type ScenarioTabRegistry,
  type SimulationService,
} from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ScenarioBroadcast } from "../../app/scenario.app.ts";
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
    broadcast?: Partial<ScenarioBroadcast>;
    traces?: Partial<TraceApi>;
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
  const broadcast = createApiFixture<ScenarioBroadcast>(
    {
      getTenantEmitter: () => new EventEmitter(),
      ...options.broadcast,
    },
    "Scenario broadcast",
  );

  const app = ScenarioApp.create({
    repositories: MemoryScenarioRepositories.create(),
    dependencies: {
      agents: createApiFixture<AgentApi>(),
      users: createApiFixture<UserApi>(),
      projects: createApiFixture<ProjectApi>(),
      plans: createApiFixture<EntitlementApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
      presence: createApiFixture<PresenceApi>(),
      auditLog: createApiFixture<AuditLogApi>(),
      traces: createApiFixture<TraceApi>(options.traces, "Trace API"),
    },
    members: {
      agentTesting: createApiFixture<AgentTestService>(),
      simulations,
      scenarioExecution: createApiFixture<ScenarioExecutionService>(),
      scenarioTabs,
      broadcast,
      resultAtoms: createApiFixture<ResultAtomsService>(),
      runConfigurations: createApiFixture<RunConfigurationsService>(),
      encryption: createApiFixture<Encryption>(),
      rateLimiter: { check: async () => ({ allowed: true }) },
      publicBaseUrl: "https://app.langwatch.test",
    },
    resources: createApiFixture<ResourceOwnership>(),
    config: undefined,
    secrets: {} as never,
  });

  return { app, simulations, scenarioTabs, broadcast };
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
