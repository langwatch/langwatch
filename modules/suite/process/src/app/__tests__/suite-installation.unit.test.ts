/**
 * @vitest-environment node
 * The installer over memory persistence, in both roles that boot it.
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createApp, withMemoryRepositories } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ScenarioApi as ScenarioApiContract } from "@langwatch/scenario-contract";
import { SuiteApi, SuiteNameTakenError } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { CollapsingRunCommands } from "../../__tests__/support/collapsing-run-commands.ts";
import { MemorySuiteDatabase } from "../../repositories/memory/memory.suite.database.ts";
import { suiteServer } from "../../suite.server.ts";
import {
  memoryAgentApi,
  memoryScenarioApi,
  SuiteWorld,
  TEST_PROJECT,
} from "../../transport/__tests__/suite-rest.harness.ts";

/**
 * The one store-backed member `SuiteApp` declares reading. Installing on
 * the memory tier never reaches a store, so boot needs the member to
 * EXIST — a stub that refuses on use proves it, naming the failure.
 */
function analyticalWithoutStore(): ClickHouseQueryClient {
  const client: Partial<ClickHouseQueryClient> = {};
  return new Proxy(client, {
    get(_target, property) {
      throw new Error(`The memory tier must not reach ClickHouse (read "${String(property)}").`);
    },
  }) as ClickHouseQueryClient;
}

function process(role: "api" | "worker") {
  return createApp({ role })
    .withModules([withMemoryRepositories(suiteServer)])
    .withAnalytical(analyticalWithoutStore())
    .withKeyvalue(null)
    .withMembers({ publicBaseUrl: undefined })
    .provide({
      scenario: createApiFixture<ScenarioApiContract>({ findTestSuite: async () => null }),
      agent: createApiFixture<AgentApi>({}),
      prompt: createApiFixture<PromptApi>({}),
      evaluator: createApiFixture<EvaluatorApi>({}),
      project: createApiFixture<ProjectApi>({ findOrganizationId: async () => "organization-1" }),
      "data-retention": createApiFixture<DataRetentionApi>({
        getPlatformDefaultRetentionDays: () => 49,
        getResolvedForProject: async () => RETAINED,
      }),
      "feature-flag": createApiFixture<FeatureFlagApi>({}),
      "model-provider": createApiFixture<ModelProviderApi>({}),
    });
}

const RETAINED = { traces: 30, scenarios: 365, experiments: 30 };

const plan = { projectId: "project-1", name: "Nightly", scenarioIds: ["scenario-1"] };

describe("suite app installation", () => {
  /** @scenario "A module's pipeline declares each tenant's retention from data retention" */
  it("declares each tenant's retention on its pipeline as data retention resolves it", async () => {
    const eventing = new EventSourcing({
      enabled: false,
      processStore: InMemoryProcessStore.createForTesting(),
    });
    const runtime = await process("worker").withEventing(eventing).boot();

    try {
      const pipeline = eventing.definitions.find(
        (definition) => definition.metadata.name === "suite_run_processing",
      );

      await expect(
        pipeline?.open((definition) => definition.retentionPolicyResolver?.resolve("project-1")),
      ).resolves.toEqual(RETAINED);
    } finally {
      await runtime.stop();
    }
  });

  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

    try {
      const app = runtime.service(SuiteApi);
      const created = await app.create(plan);

      expect(runtime.module(suiteServer).provided).toBe(app);
      expect(created.slug).toBe("nightly");

      await expect(app.list({ projectId: plan.projectId })).resolves.toMatchObject([
        { id: created.id },
      ]);
      await expect(app.create(plan)).rejects.toBeInstanceOf(SuiteNameTakenError);
    } finally {
      await runtime.stop();
    }
  });

  it("allocates independent memory repositories for each installation", async () => {
    const first = await process("api").boot();
    const second = await process("api").boot();

    try {
      await first.service(SuiteApi).create(plan);

      await expect(
        second.service(SuiteApi).list({ projectId: plan.projectId }),
      ).resolves.toHaveLength(0);
    } finally {
      await Promise.all([first.stop(), second.stop()]);
    }
  });
});

describe("given a stored run plan in the api role", () => {
  /** @scenario "Running a stored run plan through the process schedules its runs" */
  it("starts the suite run and has the scenario owner queue its run", async () => {
    const world = new SuiteWorld(MemorySuiteDatabase.create());
    const commands = new CollapsingRunCommands();
    const scenario = world.addScenario({ name: "Refund flow" });
    const agent = world.addAgent();
    const runtime = await createApp({ role: "api" })
      .withModules([withMemoryRepositories(suiteServer)])
      .withAnalytical(analyticalWithoutStore())
      .withKeyvalue(null)
      .withEventing(
        new EventSourcing({
          eventStore: EventStoreMemory.createForTesting(),
          executionTarget: "api",
          consumersEnabled: false,
          processManagerMode: "producer-only",
        }),
      )
      .withMembers({ publicBaseUrl: "https://app.langwatch.test" })
      .provide({
        scenario: memoryScenarioApi(world, commands),
        agent: memoryAgentApi(world),
        prompt: createApiFixture<PromptApi>({ getExistingIds: async () => [] }),
        evaluator: createApiFixture<EvaluatorApi>({}),
        project: createApiFixture<ProjectApi>({
          findOrganizationId: async () => TEST_PROJECT.organizationId,
        }),
        "data-retention": createApiFixture<DataRetentionApi>({
          getPlatformDefaultRetentionDays: () => 49,
        }),
        "feature-flag": createApiFixture<FeatureFlagApi>({}),
        "model-provider": createApiFixture<ModelProviderApi>({}),
      })
      .boot();

    try {
      const app = runtime.service(SuiteApi);
      const plan = await app.create({
        projectId: TEST_PROJECT.id,
        name: "Nightly",
        scenarioIds: [scenario.id],
        targets: [{ type: "http", referenceId: agent.id }],
      });

      const result = await app.run({
        id: plan.id,
        projectId: TEST_PROJECT.id,
        idempotencyKey: "installation-run-1",
      });

      expect(result.jobCount).toBe(1);
      expect(commands.queued).toMatchObject([
        { projectId: TEST_PROJECT.id, scenarioId: scenario.id, batchRunId: result.batchRunId },
      ]);
    } finally {
      await runtime.stop();
    }
  });
});
