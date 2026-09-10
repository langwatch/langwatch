/**
 * @vitest-environment node
 *
 * The scenario module, installed and booted the way `installApiScenario`
 * builds it: memory-backed, over `scenarioServer`
 * (`defineModule("scenario").withRepositories(...).withApp(ScenarioApp)`).
 * Proves the repository seam and the app factory the annotated runtime
 * expects, not the full production collaborator graph - the heavier private
 * services (agent testing, the run executor) are inert stand-ins here; see
 * `scenario.composition.ts`'s `installApiScenario` doc comment for what is
 * still outside this seam.
 */
import {
  AgentTestService,
  ResultAtomsService,
  RunConfigurationsService,
  ScenarioClockPort,
  ScenarioExecutionService,
  ScenarioIdPort,
  ScenarioSecretCipherPort,
  ScenarioTestSuiteIdPort,
  type ScenarioAppInfrastructure,
  type ScenarioBroadcast,
} from "@langwatch/scenario-server";
import { ScenarioTabRegistry, SimulationService } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { installApiScenario } from "../scenario.composition.ts";

class TestScenarioId extends ScenarioIdPort {
  #next = 0;
  next(): string {
    this.#next += 1;
    return `scenario_boot_${this.#next}`;
  }
}

class TestScenarioTestSuiteId extends ScenarioTestSuiteIdPort {
  next(): string {
    return "test_suite_boot";
  }
}

class TestScenarioClock extends ScenarioClockPort {
  now(): Date {
    return new Date(0);
  }
}

class TestScenarioSecretCipher extends ScenarioSecretCipherPort {
  encrypt(plaintext: string): string {
    return plaintext;
  }
  decrypt(ciphertext: string): string {
    return ciphertext;
  }
}

/** Every other infrastructure member this boot never calls, held inert. */
function infrastructure(): ScenarioAppInfrastructure {
  return {
    agentTesting: Object.create(AgentTestService.prototype) as AgentTestService,
    simulations: Object.create(SimulationService.prototype) as SimulationService,
    scenarioExecution: Object.create(ScenarioExecutionService.prototype) as ScenarioExecutionService,
    scenarioTabs: Object.create(ScenarioTabRegistry.prototype) as ScenarioTabRegistry,
    broadcast: { getTenantEmitter: () => Object.create(null) } as ScenarioBroadcast,
    resultAtoms: Object.create(ResultAtomsService.prototype) as ResultAtomsService,
    runConfigurations: Object.create(RunConfigurationsService.prototype) as RunConfigurationsService,
    ids: new TestScenarioId(),
    testSuiteIds: new TestScenarioTestSuiteId(),
    clock: new TestScenarioClock(),
    secretCipher: new TestScenarioSecretCipher(),
  };
}

describe("given the API process installs the scenario module memory-backed", () => {
  it("lists what it just created, with no database", async () => {
    const users = createApiFixture<UserApi>();

    const scenarios = await installApiScenario({
      persistence: { backend: "memory" },
      users,
      infrastructure: infrastructure(),
    });

    const created = await scenarios.create(
      {
        projectId: "project-1",
        name: "Refund a duplicate charge",
        situation: "The customer was billed twice for the same order.",
        criteria: ["Offers a refund"],
        labels: [],
      },
      { id: "user-1" },
    );

    await expect(scenarios.list({ projectId: "project-1" })).resolves.toEqual([
      expect.objectContaining({ id: created.id, name: "Refund a duplicate charge" }),
    ]);
  });
});
