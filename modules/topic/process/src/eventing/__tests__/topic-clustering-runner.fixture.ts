import type { TraceTopicClusteringPage } from "@langwatch/trace-contract";
import { vi } from "vitest";

import type { TopicClusteringRunnerDeps } from "../topic-clustering-runner.intent.ts";

export function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    name: "Test Project",
    team: { organizationId: "org-1" },
    ...overrides,
  };
}

/**
 * Fake runner boundaries: production wires these to the model-provider
 * cascade, evaluation's clustering op, guarded Prisma client, and pipeline
 * commands — here they're plain stubs, typed to keep vi.fn mock types.
 */
export function fakeRunnerDeps(overrides: Partial<TopicClusteringRunnerDeps> = {}) {
  const deps = {
    traces: {
      readTopicClusteringCounts: vi.fn().mockResolvedValue({
        totalTracesCount: 0,
        recentTracesCount: 0,
        assignedTracesCount: 0,
      }),
      readTopicClusteringPage: vi.fn().mockResolvedValue(tracePage(0)),
      assignTopic: vi.fn().mockResolvedValue(undefined),
    },
    models: {
      resolveClusteringModel: vi.fn().mockResolvedValue({ model: "openai/gpt-5-mini" }),
      findExecutionProviders: vi.fn().mockResolvedValue({ openai: { enabled: true } }),
      resolveEmbeddingsModel: vi.fn().mockResolvedValue({
        model: "text-embedding-3-small",
        modelProvider: { enabled: true },
      }),
      prepareLitellmParams: vi.fn().mockResolvedValue({ model: "gpt-5-mini" }),
    },
    evaluations: {
      requestTopicClustering: vi.fn().mockResolvedValue({
        kind: "clustered",
        response: { topics: [], subtopics: [], traces: [], cost: null },
      }),
    },
    repository: {
      findProject: vi.fn().mockResolvedValue(makeProject()),
      findTopicIndexRows: vi.fn().mockResolvedValue([]),
      findModelTopics: vi.fn().mockResolvedValue([]),
      findModelSubtopics: vi.fn().mockResolvedValue([]),
      recordClusteringCost: vi.fn().mockResolvedValue(undefined),
      findTopicModelCursor: vi.fn().mockResolvedValue({ id: "topicmodel_1" }),
      findSeedTopicRows: vi.fn().mockResolvedValue([]),
      findProjectsWithTopicsPage: vi.fn().mockResolvedValue([]),
      findEligibleProjectsPage: vi.fn().mockResolvedValue([]),
      findOwnedTopicModelProjectIds: vi.fn().mockResolvedValue([]),
      findAlreadyScheduledProjectIds: vi.fn().mockResolvedValue([]),
    },
    migration: {
      seedProjectTopicModel: vi.fn().mockResolvedValue("skipped" as const),
    },
    commands: {
      recordTopics: vi.fn().mockResolvedValue(undefined),
      requestClustering: vi.fn().mockResolvedValue(undefined),
    },
    observePayloadSize: vi.fn(),
  };
  // Compile-time check that the fakes satisfy the real deps; the returned
  // type keeps the vi.fn mock types so tests can assert calls directly.
  const _checked: TopicClusteringRunnerDeps = deps;
  return Object.assign(deps, overrides);
}

/** A page as trace answers it: `count` clusterable traces, newest first. */
export function tracePage(count: number, now = Date.now()): TraceTopicClusteringPage {
  const traces = Array.from({ length: count }, (_, i) => ({
    trace_id: `trace-${i}`,
    input: `User message ${i}`,
    topic_id: null,
    subtopic_id: null,
  }));
  return {
    traces,
    lastSort: count > 0 ? [now - (count - 1) * 1000, `trace-${count - 1}`] : undefined,
    returnedCount: count,
  };
}
