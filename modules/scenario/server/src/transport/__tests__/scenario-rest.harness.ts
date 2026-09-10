import { EventEmitter } from "node:events";

import type { AgentTestService } from "../../services/agent-test.service.ts";
import type { ResultAtomsService } from "../../services/result-atoms.service.ts";
import type { RunConfigurationsService } from "../../services/run-configurations.service.ts";
import { ScenarioClock } from "../../app/scenario.app.ts";
import { ScenarioId, ScenarioTestSuiteId } from "../../app/scenario.app.ts";
import { ScenarioSecretCipher } from "../../app/scenario.app.ts";
import { MemoryScenarioRepositories } from "../../repositories/memory/memory.scenario.repositories.ts";
import { ScenarioApp } from "../../app/scenario.app.ts";
import {
  type ScenarioExecutionService,
  type ScenarioTabRegistry,
  type SimulationService,
} from "@langwatch/scenario-contract";
import type { ResourceOwnership } from "@langwatch/runtime-composition";
import type { UserApi } from "@langwatch/user-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const PROJECT_ID = "project_scenario_rest";
export const PROJECT_SLUG = "scenario-rest-project";

class SequentialScenarioId implements ScenarioId {
  #nextId = 0;

  next(): string {
    this.#nextId += 1;
    return `scenario_3B6H8sKpQxVf${this.#nextId}`;
  }
}

class SequentialTestSuiteId implements ScenarioTestSuiteId {
  #nextId = 0;

  next(): string {
    this.#nextId += 1;
    return `suite_3B6H8sKpQxVf${this.#nextId}`;
  }
}

class FixedScenarioClock implements ScenarioClock {
  now(): Date {
    return new Date("2026-09-10T00:00:00.000Z");
  }
}

class PlainScenarioCipher implements ScenarioSecretCipher {
  encrypt(plaintext: string): string {
    return plaintext;
  }

  decrypt(ciphertext: string): string {
    return ciphertext;
  }
}

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
    dependencies: { users: createApiFixture<UserApi>() },
    infrastructure: {
      agentTesting: createApiFixture<AgentTestService>(),
      simulations,
      scenarioExecution: createApiFixture<ScenarioExecutionService>(),
      scenarioTabs,
      broadcast: { getTenantEmitter: () => new EventEmitter() },
      resultAtoms: createApiFixture<ResultAtomsService>(),
      runConfigurations: createApiFixture<RunConfigurationsService>(),
      ids: new SequentialScenarioId(),
      testSuiteIds: new SequentialTestSuiteId(),
      clock: new FixedScenarioClock(),
      secretCipher: new PlainScenarioCipher(),
    },
    resources: createApiFixture<ResourceOwnership>(),
    config: void 0,
  });

  return { app, simulations, scenarioTabs };
}

export function createScenarioRestTestRuntime(options: { authenticated?: boolean } = {}) {
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
    viewerUserId: "user_scenario_rest",
    actorId: "user_scenario_rest",
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
