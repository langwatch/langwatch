import { describe, expect, it, vi } from "vitest";
import {
  PrismaTopicRepository,
  type TopicDatabase,
} from "../src/repositories/prisma/prisma.topic.repository";

const topicRows = [
  {
    id: "topic-2",
    name: "Payments",
    parentId: "topic-root",
    automaticallyGenerated: true,
  },
  {
    id: "topic-root",
    name: "Support",
    parentId: null,
    automaticallyGenerated: false,
  },
];

function makeDatabase(
  overrides: {
    topicRows?: unknown[];
    projection?: unknown;
    history?: unknown;
  } = {},
) {
  const topicFindMany = vi.fn().mockResolvedValue(overrides.topicRows ?? topicRows);
  const statusFindUnique = vi.fn().mockResolvedValue(overrides.projection ?? null);
  const historyFindUnique = vi
    .fn()
    .mockResolvedValue(overrides.history === undefined ? null : { Runs: overrides.history });

  const database = {
    topic: { findMany: topicFindMany },
    topicClusteringRunProjection: { findUnique: statusFindUnique },
    topicClusteringRunHistoryProjection: { findUnique: historyFindUnique },
  } as unknown as TopicDatabase;

  return { database, topicFindMany, statusFindUnique, historyFindUnique };
}

describe("PrismaTopicRepository", () => {
  it("preserves the database order of topics and the legacy read selection", async () => {
    const { database, topicFindMany } = makeDatabase();
    const repository = PrismaTopicRepository.create(database);

    await expect(repository.findAll({ projectId: "project-1" })).resolves.toEqual(topicRows);
    expect(topicFindMany).toHaveBeenCalledWith({
      where: { projectId: "project-1" },
      select: {
        id: true,
        name: true,
        parentId: true,
        automaticallyGenerated: true,
      },
    });
  });

  it("does not query for an empty name lookup", async () => {
    const { database, topicFindMany } = makeDatabase();
    const repository = PrismaTopicRepository.create(database);

    await expect(repository.findNamesByIds({ projectId: "project-1", ids: [] })).resolves.toEqual(
      new Map(),
    );
    expect(topicFindMany).not.toHaveBeenCalled();
  });

  it("maps and validates the status projection without exposing raw error text", async () => {
    const { database, statusFindUnique } = makeDatabase({
      projection: {
        LastRequestedAt: 100,
        LastRequestTrigger: "manual",
        LastRunAt: 200,
        LastRunOutcome: "failed",
        LastRunMode: "batch",
        LastRunSkippedReason: null,
        LastRunErrorCode: "model_provider_auth",
        LastRunErrorUserActionable: true,
        LastRunTracesProcessed: 12,
        LastRunTopicsCount: 2,
        LastRunSubtopicsCount: 3,
        InProgressRunId: null,
        InProgressStartedAt: null,
        OccurredAt: 200,
        LastRunError: "provider secret must never cross this boundary",
      },
    });
    const repository = PrismaTopicRepository.create(database);

    await expect(repository.findClusteringStatus({ projectId: "project-1" })).resolves.toEqual({
      projection: {
        lastRequestedAt: 100,
        lastRequestTrigger: "manual",
        lastRunAt: 200,
        lastRunOutcome: "failed",
        lastRunMode: "batch",
        lastRunSkippedReason: null,
        lastRunErrorCode: "model_provider_auth",
        lastRunErrorUserActionable: true,
        lastRunTracesProcessed: 12,
        lastRunTopicsCount: 2,
        lastRunSubtopicsCount: 3,
        inProgressRunId: null,
        inProgressStartedAt: null,
        occurredAt: 200,
      },
    });
    expect(statusFindUnique).toHaveBeenCalledWith({
      where: { projectId: "project-1" },
    });
  });

  it("returns an empty history when the projection row is missing", async () => {
    const { database, historyFindUnique } = makeDatabase();
    const repository = PrismaTopicRepository.create(database);

    await expect(repository.findClusteringRunHistory({ projectId: "project-1" })).resolves.toEqual(
      [],
    );
    expect(historyFindUnique).toHaveBeenCalledWith({
      where: { projectId: "project-1" },
      select: { Runs: true },
    });
  });

  it("returns an empty history for malformed projection JSON", async () => {
    const { database } = makeDatabase({ history: "not an array" });
    const repository = PrismaTopicRepository.create(database);

    await expect(repository.findClusteringRunHistory({ projectId: "project-1" })).resolves.toEqual(
      [],
    );
  });
});
