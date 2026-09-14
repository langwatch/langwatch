/**
 * ScenarioApp reads `publicBaseUrl` off its own config slice, the same way
 * SuiteApp does - see specs/scenarios/scenario-api.feature.
 * @vitest-environment node
 */
import { EventEmitter } from "node:events";

import type { AgentTestService } from "../../services/agent-test.service.ts";
import type { ResultAtomsService } from "../../services/result-atoms.service.ts";
import type { RunConfigurationsService } from "../../services/run-configurations.service.ts";
import type {
  ScenarioClock,
  ScenarioId,
  ScenarioSecretCipher,
  ScenarioTestSuiteId,
} from "../scenario.app.ts";
import { ScenarioApp } from "../scenario.app.ts";
import { MemoryScenarioRepositories } from "../../repositories/memory/memory.scenario.repositories.ts";
import {
  type ScenarioExecutionService,
  type ScenarioTabRegistry,
  type SimulationService,
} from "@langwatch/scenario-contract";
import type { ResourceOwnership } from "@langwatch/runtime-composition";
import type { UserApi } from "@langwatch/user-contract";
import type { Encryption } from "@langwatch/infrastructure/members";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

function buildProductionApp(config: unknown) {
  return ScenarioApp.create({
    repositories: MemoryScenarioRepositories.create(),
    dependencies: { users: createApiFixture<UserApi>() },
    // The same parse boot runs before handing `create` its config.
    config: ScenarioApp.configSchema.parse(config),
    resources: createApiFixture<ResourceOwnership>(),
    members: {
      encryption: createApiFixture<Encryption>({
        encrypt: (value: string) => value,
        decrypt: (value: string) => value,
      }),
      agentTesting: createApiFixture<AgentTestService>(),
      simulations: createApiFixture<SimulationService>(),
      scenarioExecution: createApiFixture<ScenarioExecutionService>(),
      scenarioTabs: createApiFixture<ScenarioTabRegistry>(),
      broadcast: { getTenantEmitter: () => new EventEmitter() },
      resultAtoms: createApiFixture<ResultAtomsService>(),
      runConfigurations: createApiFixture<RunConfigurationsService>(),
      ids: {} as ScenarioId,
      testSuiteIds: {} as ScenarioTestSuiteId,
      clock: {} as ScenarioClock,
      secretCipher: {} as ScenarioSecretCipher,
    },
  });
}

describe("ScenarioApp built the way production composes it", () => {
  describe("given a deployment that configured a public base URL", () => {
    /** @scenario "A scenario's platform link answers when a public base URL is configured" */
    it("answers a platform link instead of refusing by name", () => {
      const app = buildProductionApp({ publicBaseUrl: "https://app.langwatch.test" });

      expect(app.platformUrl({ projectSlug: "acme", path: "/scenarios/scenario_1" })).toBe(
        "https://app.langwatch.test/acme/scenarios/scenario_1",
      );
    });
  });

  describe("given a deployment that named no public base URL", () => {
    /** @scenario "A scenario's platform link refuses by name without a public base URL" */
    it("still refuses by name, as it did before this deployment had a config seam", () => {
      const app = buildProductionApp({});

      expect(() =>
        app.platformUrl({ projectSlug: "acme", path: "/scenarios/scenario_1" }),
      ).toThrow(/named no public base URL/);
    });
  });

  describe("given no config slice at all", () => {
    /** @scenario "ScenarioApp boots even when its process names no scenario config slice" */
    it("parses to the same absent-publicBaseUrl default", () => {
      const app = buildProductionApp(undefined);

      expect(() =>
        app.platformUrl({ projectSlug: "acme", path: "/scenarios/scenario_1" }),
      ).toThrow(/named no public base URL/);
    });
  });
});
