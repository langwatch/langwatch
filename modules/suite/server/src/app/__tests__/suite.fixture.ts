/**
 * The suite application over memory repositories, for a test that wants the
 * real decisions and none of the datastores. Peers arrive as API fixtures, so
 * an operation the test did not stub refuses by name rather than answering
 * undefined.
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { SuiteExecution } from "../suite.app.ts";
import { MemorySuiteDatabase } from "../../repositories/memory/memory.suite.database.ts";
import { MemorySuiteRepository } from "../../repositories/memory/memory.suite.repository.ts";
import type { SuiteRepositories } from "../../repositories/suite.repositories.ts";
import { SuiteApp } from "../suite.app.ts";

/**
 * The `clickhouse` member, for a test that never reads a run projection: the
 * installation assertions only create and list plans, so nothing queries the
 * run-history repository this client would otherwise back.
 *
 * It refuses on any access rather than being an empty object, so that claim is
 * enforced instead of merely asserted. A scenario that starts reading a
 * projection fails here, naming the property, rather than somewhere downstream
 * with `undefined is not a function`.
 */
export function createSuiteTestClickHouse(): ClickHouseQueryClient {
  return new Proxy({} as ClickHouseQueryClient, {
    get(_target, property) {
      // Symbols are how a runtime inspects a value (promise-unwrapping, printing).
      // Refusing those would fail the test for looking at it, not for using it.
      if (typeof property === "symbol") return void 0;

      throw new Error(
        `The suite installation test reached clickhouse.${property}, which it is not meant to. ` +
          `Suite is handed this member because it reads one; give the fixture real behaviour ` +
          `for the path you are adding rather than deleting this refusal.`,
      );
    },
  });
}

/** A run that is accepted and scheduled nowhere, recording what it was handed. */
export class RecordingSuiteExecution implements SuiteExecution {
  readonly executed: Parameters<SuiteExecution["execute"]>[0][] = [];

  async execute(input: Parameters<SuiteExecution["execute"]>[0]) {
    this.executed.push(input);

    return {
      batchRunId: `batch_${this.executed.length}`,
      setId: "set_1",
      jobCount: input.activeScenarioIds.length * input.activeTargets.length * input.repeatCount,
      skippedArchived: input.skippedArchived,
      items: [],
    };
  }
}

export function createSuiteTestRepositories(database?: MemorySuiteDatabase): SuiteRepositories {
  return { suites: MemorySuiteRepository.create({ database: database ?? MemorySuiteDatabase.create() }) };
}

export function createSuiteTestApp(
  input: Readonly<{
    repositories?: SuiteRepositories;
    execution?: SuiteExecution;
    dependencies?: Partial<{
      scenarios: ScenarioApi;
      agents: AgentApi;
      prompts: PromptApi;
      projects: ProjectApi;
    }>;
  }> = {},
): SuiteApp {
  return SuiteApp.create({
    repositories: input.repositories ?? createSuiteTestRepositories(),
    dependencies: {
      scenarios: input.dependencies?.scenarios ?? createApiFixture<ScenarioApi>({}),
      agents: input.dependencies?.agents ?? createApiFixture<AgentApi>({}),
      prompts: input.dependencies?.prompts ?? createApiFixture<PromptApi>({}),
      projects:
        input.dependencies?.projects ??
        createApiFixture<ProjectApi>({
          tryGetOrganizationId: async () => "organization-1",
        }),
    },
    members: {
      execution: input.execution ?? new RecordingSuiteExecution(),
      resolveClickHouseClient: null,
      defaultRetentionDays: 30,
    },
    config: void 0,
    resources: new ResourceScope(),
  });
}
