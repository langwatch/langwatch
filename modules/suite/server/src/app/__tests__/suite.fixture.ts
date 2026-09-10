/**
 * The suite application over memory repositories, for a test that wants the
 * real decisions and none of the datastores. Peers arrive as API fixtures, so
 * an operation the test did not stub refuses by name rather than answering
 * undefined.
 */
import type { AgentApi } from "@langwatch/agent-contract";
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
    infrastructure: {
      execution: input.execution ?? new RecordingSuiteExecution(),
      resolveClickHouseClient: null,
      defaultRetentionDays: 30,
    },
    config: void 0,
    resources: new ResourceScope(),
  });
}
