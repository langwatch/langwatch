import { vi } from "vitest";
import type { TopicClusteringRunnerDeps } from "../src/intents/topic-clustering-runner.intent";

export function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    name: "Test Project",
    team: { organizationId: "org-1" },
    ...overrides,
  };
};

/**
 * Fake runner boundaries: the production composition wires these to the
 * app's model-provider cascade, staged langevals fetch, guarded Prisma
 * client, and pipeline commands; here they are plain stubs. The returned
 * type keeps the vi.fn mock types so tests can assert calls directly.
 */
export function fakeRunnerDeps(overrides: Partial<TopicClusteringRunnerDeps> = {}) {
  const deps = {
    resolveClickHouseClient: vi.fn(),
    models: {
      resolveClusteringModel: vi.fn().mockResolvedValue({ model: "openai/gpt-5-mini" }),
      findExecutionProviders: vi.fn().mockResolvedValue({ openai: { enabled: true } }),
      resolveEmbeddingsModel: vi.fn().mockResolvedValue({
        model: "text-embedding-3-small",
        modelProvider: { enabled: true },
      }),
      prepareLitellmParams: vi.fn().mockResolvedValue({ model: "gpt-5-mini" }),
    },
    langevals: {
      postClustering: vi.fn().mockResolvedValue({
        ok: true,
        statusText: "OK",
        text: () => Promise.resolve(""),
        json: () =>
          Promise.resolve({ topics: [], subtopics: [], traces: [], cost: null }),
      }),
    },
    langevalsEndpoint: "http://langevals.test" as string | null,
    repository: {
      tryFindProject: vi.fn().mockResolvedValue(makeProject()),
      findTopicIndexRows: vi.fn().mockResolvedValue([]),
      findModelTopics: vi.fn().mockResolvedValue([]),
      findModelSubtopics: vi.fn().mockResolvedValue([]),
      recordClusteringCost: vi.fn().mockResolvedValue(undefined),
      tryFindTopicModelCursor: vi.fn().mockResolvedValue({ id: "topicmodel_1" }),
      findSeedTopicRows: vi.fn().mockResolvedValue([]),
      findProjectsWithTopicsPage: vi.fn().mockResolvedValue([]),
      findEligibleProjectsPage: vi.fn().mockResolvedValue([]),
      findOwnedTopicModelProjectIds: vi.fn().mockResolvedValue([]),
      findAlreadyScheduledProjectIds: vi.fn().mockResolvedValue([]),
    },
    migration: {
      trySeedProjectTopicModel: vi.fn().mockResolvedValue("skipped" as const),
    },
    commands: {
      recordTopics: vi.fn().mockResolvedValue(undefined),
      assignTopic: vi.fn().mockResolvedValue(undefined),
    },
    observePayloadSize: vi.fn(),
  };
  // Compile-time check that the fakes satisfy the real deps; the returned
  // type keeps the vi.fn mock types so tests can assert calls directly.
  const _checked: TopicClusteringRunnerDeps = deps;
  return Object.assign(deps, overrides);
}
