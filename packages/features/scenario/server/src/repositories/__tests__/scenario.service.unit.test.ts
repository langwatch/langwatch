import {
  ScenarioNotFoundError,
  type Scenario,
  type ScenarioTestSuite,
  type ScenarioTestSuiteIdInput,
  type ScenarioActor,
} from "@langwatch/scenario-contract";
import { SimulationService } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";
import { ScenarioRepository } from "../scenario.repository";
import { ScenarioService } from "../../services/scenario.service";
import { ScenarioClockPort } from "../../ports/scenario-clock.port";
import { ScenarioTestSuiteIdPort, ScenarioIdPort } from "../../ports/scenario-id.port";
import { ScenarioSecretCipherPort } from "../../ports/scenario-secret-cipher.port";
import { MemoryScenarioRepository } from "./fixtures/memory-scenario.repository";

const simulations = Object.create(SimulationService.prototype) as SimulationService;

class TestScenarioId extends ScenarioIdPort {
  constructor(private readonly value: string) {
    super();
  }
  next(): string {
    return this.value;
  }
}

class TestScenarioTestSuiteId extends ScenarioTestSuiteIdPort {
  constructor(private readonly value: string) {
    super();
  }

  next(): string {
    return this.value;
  }
}

class TestScenarioClock extends ScenarioClockPort {
  constructor(private readonly value: Date = new Date(0)) {
    super();
  }
  now(): Date {
    return this.value;
  }
}

class TestScenarioSecretCipher extends ScenarioSecretCipherPort {
  encrypt(value: string): string {
    return `encrypted:${value}`;
  }

  decrypt(value: string): string {
    return value.replace(/^encrypted:/, "");
  }
}

function serviceOptions(
  repository: ScenarioRepository,
  id: string,
  clock = new TestScenarioClock(),
) {
  return {
    repository,
    simulations,
    ids: new TestScenarioId(id),
    testSuiteIds: new TestScenarioTestSuiteId(`test_suite_${id}`),
    clock,
    secretCipher: new TestScenarioSecretCipher(),
  };
}

describe("ScenarioService", () => {
  /** @scenario "A required scenario read is tenant scoped" */
  /** @scenario "Optional scenario discovery is explicit" */
  it("keeps reads project-scoped and only makes optional reads nullable", async () => {
    const repository = new MemoryScenarioRepository();
    const service = ScenarioService.create(serviceOptions(repository, "scenario_1"));
    await service.create({
      projectId: "project-a",
      name: "Refund flow",
      situation: "A customer asks for a refund",
      criteria: [],
      labels: [],
    });

    expect(await service.tryGetById({ id: "scenario_1", projectId: "project-b" })).toBeNull();
    await expect(
      service.getById({ id: "scenario_1", projectId: "project-b" }),
    ).rejects.toMatchObject({
      name: "ScenarioNotFoundError",
      code: "scenario_not_found",
      httpStatus: 404,
      meta: { scenarioId: "scenario_1" },
    });
    expect(await service.list({ projectId: "project-a" })).toHaveLength(1);
    await expect(service.count({ projectId: "project-a" })).resolves.toBe(1);
    await expect(service.count({ projectId: "project-b" })).resolves.toBe(0);
  });

  /** @scenario "Scenario archive delivery is retry safe" */
  it("preserves the first archive timestamp across retry delivery", async () => {
    const repository = new MemoryScenarioRepository();
    const first = new Date("2026-01-01T00:00:00.000Z");
    const later = new Date("2026-01-02T00:00:00.000Z");
    const service = ScenarioService.create(
      serviceOptions(repository, "scenario_1", new TestScenarioClock(first)),
    );
    await service.create({
      projectId: "project-a",
      name: "Refund flow",
      situation: "A customer asks for a refund",
      criteria: [],
      labels: [],
    });

    const archived = await service.archive({ id: "scenario_1", projectId: "project-a" });
    const retried = await ScenarioService.create(
      serviceOptions(repository, "unused", new TestScenarioClock(later)),
    ).archive({ id: "scenario_1", projectId: "project-a" });

    expect(archived.archivedAt).toEqual(first);
    expect(retried.archivedAt).toEqual(first);
  });

  it("keeps run configuration parameter JSON project-scoped", async () => {
    const repository = new MemoryScenarioRepository();
    const service = ScenarioService.create(serviceOptions(repository, "scenario_1"));
    await service.create({
      projectId: "project-a",
      name: "Refund flow",
      situation: "A {{ params.region }} customer asks for a refund",
      criteria: ["Answers the question"],
      labels: [],
      parameters: [
        {
          name: "region",
          description: "The customer's billing region",
          defaultValue: "eu-central",
        },
      ],
    });

    await expect(
      service.getRunConfigs({
        ids: ["scenario_1"],
        projectId: "project-a",
      }),
    ).resolves.toEqual([
      {
        id: "scenario_1",
        name: "Refund flow",
        version: 1,
        situation: "A {{ params.region }} customer asks for a refund",
        criteria: ["Answers the question"],
        parameters: [
          {
            name: "region",
            description: "The customer's billing region",
            defaultValue: "eu-central",
          },
        ],
      },
    ]);
    await expect(
      service.resolveRunParameters({
        projectId: "project-a",
        scenarioId: "scenario_1",
      }),
    ).resolves.toEqual({
      parameters: { region: "eu-central" },
      secretParameters: {},
      scenarioVersion: 1,
    });
    await expect(
      service.getRunConfigs({
        ids: ["scenario_1"],
        projectId: "project-b",
      }),
    ).resolves.toEqual([]);
    await expect(
      service.resolveRunParameters({
        projectId: "project-b",
        scenarioId: "scenario_1",
      }),
    ).rejects.toBeInstanceOf(ScenarioNotFoundError);
  });

  it("persists model selections through the canonical update boundary", async () => {
    const repository = new MemoryScenarioRepository();
    const service = ScenarioService.create(serviceOptions(repository, "scenario_1"));
    await service.create({
      projectId: "project-a",
      name: "Refund flow",
      situation: "A customer asks for a refund",
      criteria: [],
      labels: [],
    });

    await expect(
      service.update({
        id: "scenario_1",
        projectId: "project-a",
        simulatorModel: "openai/gpt-5-mini",
        judgeModel: "openai/gpt-5-nano",
      }),
    ).resolves.toMatchObject({
      simulatorModel: "openai/gpt-5-mini",
      judgeModel: "openai/gpt-5-nano",
    });
    await expect(
      service.getById({ id: "scenario_1", projectId: "project-a" }),
    ).resolves.toMatchObject({
      simulatorModel: "openai/gpt-5-mini",
      judgeModel: "openai/gpt-5-nano",
    });
  });

  it("resolves a suite's scenarios together and encrypts secret values", async () => {
    const service = ScenarioService.create(
      serviceOptions(new MemoryScenarioRepository(), "scenario_1"),
    );

    await expect(
      service.resolveRunParametersForScenarios({
        scenarios: [
          {
            id: "scenario_1",
            name: "Refund flow",
            version: 1,
            situation: "A {{ params.region }} customer asks for help",
            criteria: [],
            parameters: [
              { name: "region", defaultValue: "eu" },
              { name: "api_token", secret: true },
            ],
          },
        ],
        values: { api_token: "token-live" },
      }),
    ).resolves.toEqual([
      {
        scenarioId: "scenario_1",
        parameters: { region: "eu" },
        secretParameters: { api_token: "encrypted:token-live" },
        scenarioVersion: 1,
      },
    ]);
  });

  describe("given a deployment with no stored-secret encryption key", () => {
    class RefusingScenarioSecretCipher extends ScenarioSecretCipherPort {
      encrypt(): string {
        throw Object.assign(
          new Error(
            "This deployment cannot store or read scenario secrets, because it has no encryption key configured.",
          ),
          { code: "service_unavailable" },
        );
      }

      decrypt(): string {
        throw Object.assign(new Error("no encryption key configured"), {
          code: "service_unavailable",
        });
      }
    }

    /** @scenario "Writing a scenario secret refuses by name" */
    it("refuses saving a stored secret, naming the missing encryption key", async () => {
      const service = ScenarioService.create({
        ...serviceOptions(new MemoryScenarioRepository(), "scenario_1"),
        secretCipher: new RefusingScenarioSecretCipher(),
      });

      await expect(
        service.resolveRunParametersForScenarios({
          scenarios: [
            {
              id: "scenario_1",
              name: "Refund flow",
              version: 1,
              situation: "A customer asks for help",
              criteria: [],
              parameters: [{ name: "api_token", secret: true }],
            },
          ],
          values: { api_token: "token-live" },
        }),
      ).rejects.toMatchObject({
        code: "service_unavailable",
        message: expect.stringContaining("encryption key"),
      });
    });
  });

  it("rejects an unknown suite parameter before returning schedulable values", async () => {
    const service = ScenarioService.create(
      serviceOptions(new MemoryScenarioRepository(), "scenario_1"),
    );

    await expect(
      service.resolveRunParametersForScenarios({
        scenarios: [
          {
            id: "scenario_1",
            name: "Refund flow",
            version: 1,
            situation: "A customer asks for help",
            criteria: [],
            parameters: [{ name: "region", defaultValue: "eu" }],
          },
        ],
        values: { accountTier: "platinum" },
      }),
    ).rejects.toMatchObject({ code: "scenario_parameter_unknown" });
  });

  it("preserves order, duplicates, retry success, and exact failures in a batch archive", async () => {
    const repository = new MemoryScenarioRepository();
    const firstService = ScenarioService.create(serviceOptions(repository, "scenario_1"));
    const secondService = ScenarioService.create(serviceOptions(repository, "scenario_2"));
    await firstService.create({
      projectId: "project-a",
      name: "Refund flow",
      situation: "A customer asks for a refund",
      criteria: [],
      labels: [],
    });
    await secondService.create({
      projectId: "project-a",
      name: "Checkout flow",
      situation: "A customer checks out",
      criteria: [],
      labels: [],
    });
    await secondService.archive({ id: "scenario_2", projectId: "project-a" });

    await expect(
      firstService.batchArchive({
        projectId: "project-a",
        ids: [
          "scenario_2",
          "scenario_1",
          "scenario_2",
          "scenario_missing",
          "scenario_1",
          "scenario_missing",
        ],
      }),
    ).resolves.toEqual({
      archived: ["scenario_2", "scenario_1", "scenario_2", "scenario_1"],
      failed: [
        {
          id: "scenario_missing",
          error: "Not found",
        },
        {
          id: "scenario_missing",
          error: "Not found",
        },
      ],
    });
    await expect(firstService.list({ projectId: "project-a" })).resolves.toEqual([]);
  });

  describe("createTestSuite()", () => {
    describe("when the name is only spaces", () => {
      /** @scenario "A test suite created with a blank name is rejected with validation_error" */
      it("rejects the input before it reaches the repository", async () => {
        const repository = new MemoryScenarioRepository();
        const service = ScenarioService.create(serviceOptions(repository, "test_suite_1"));

        expect(() => service.createTestSuite({ projectId: "project-a", name: "   " })).toThrow();
        expect(await service.listTestSuites({ projectId: "project-a" })).toEqual([]);
      });
    });
  });

  describe("moveToTestSuite()", () => {
    describe("given a scenario already filed in one test suite", () => {
      /** @scenario "A scenario belongs to exactly one test suite" */
      it("holds only the destination test suite id, replacing the one it left", async () => {
        const repository = new MemoryScenarioRepository();
        // Each test suite is created through its own service instance so its
        // fixed id generator (see `serviceOptions`) mints a distinct id; the
        // repository underneath is shared, so every instance reads and
        // writes the same rows.
        const refunds = await ScenarioService.create(
          serviceOptions(repository, "test_suite_refunds"),
        ).createTestSuite({ projectId: "project-a", name: "Refunds" });
        const checkout = await ScenarioService.create(
          serviceOptions(repository, "test_suite_checkout"),
        ).createTestSuite({ projectId: "project-a", name: "Checkout" });
        const service = ScenarioService.create(serviceOptions(repository, "scenario_1"));
        const scenario = await service.create({
          projectId: "project-a",
          name: "Refund flow",
          situation: "A customer asks for a refund",
          criteria: [],
          labels: [],
          testSuiteId: refunds.id,
        });
        expect(scenario.testSuiteId).toBe(refunds.id);

        const moved = await service.moveToTestSuite({
          projectId: "project-a",
          scenarioId: scenario.id,
          testSuiteId: checkout.id,
        });

        // One column holds the membership, so a scenario can never answer to
        // two test suites at once: naming a new one replaces the old one,
        // never adds to it.
        expect(moved.testSuiteId).toBe(checkout.id);
        expect(moved.testSuiteId).not.toBe(refunds.id);
      });
    });
  });
});
