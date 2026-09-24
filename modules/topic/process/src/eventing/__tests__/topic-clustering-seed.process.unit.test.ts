import { describe, expect, it, vi } from "vitest";

import { LegacyImportTopicClusteringMigration } from "../../migrations/legacy-import.topic-clustering.migration.ts";
import { MemoryTopicClusteringClaimRepository } from "../../repositories/memory/memory.topic-clustering-claim.repository.ts";
import type { TopicClusteringRepository } from "../../repositories/topic-clustering.repository.ts";
import { runClusteringScheduleSeed, runTopicModelSeed } from "../topic-clustering-seed.intent.ts";
import {
  TOPIC_CLUSTERING_SEED_INITIAL_STATE,
  topicClusteringSeedWake,
} from "../topic-clustering-seed.process.ts";

function fakeRepository() {
  const repository = {
    findProject: vi.fn(),
    findTopicIndexRows: vi.fn(),
    findModelTopics: vi.fn(),
    findModelSubtopics: vi.fn(),
    recordClusteringCost: vi.fn(),
    findTopicModelCursor: vi.fn(),
    findSeedTopicRows: vi.fn(),
    findProjectsWithTopicsPage: vi.fn().mockResolvedValue([]),
    findEligibleProjectsPage: vi.fn().mockResolvedValue([]),
    findOwnedTopicModelProjectIds: vi.fn().mockResolvedValue([]),
    findAlreadyScheduledProjectIds: vi.fn().mockResolvedValue([]),
  };
  const _checked: TopicClusteringRepository = repository;
  return repository;
}

function makeMigration(repository: TopicClusteringRepository) {
  return LegacyImportTopicClusteringMigration.create({
    repository,
    claims: MemoryTopicClusteringClaimRepository.create(),
    commands: {
      recordTopics: vi.fn().mockResolvedValue(undefined),
      requestClustering: vi.fn().mockResolvedValue(undefined),
    },
  });
}

function wakeIntents(at: number) {
  const intent =
    (intentType: string) => (messageKey: string, payload: { scheduledFor: number }) => ({
      intentType,
      messageKey,
      payload,
    });
  return topicClusteringSeedWake(TOPIC_CLUSTERING_SEED_INITIAL_STATE, {
    at,
    now: at,
    key: "topicClusteringSeed",
    projectId: "",
    intents: { seedTopicModels: intent("seedTopicModels"), seedSchedules: intent("seedSchedules") },
  });
}

describe("the topic clustering seed process", () => {
  describe("when its scheduled wake fires", () => {
    /** @scenario "Existing projects are backfilled on a scheduled wake" */
    it("asks for both seed passes, keyed by the wake", () => {
      const evolution = wakeIntents(1_000);

      expect(evolution.intents).toEqual([
        {
          intentType: "seedTopicModels",
          messageKey: "topics:1000",
          payload: { scheduledFor: 1_000 },
        },
        {
          intentType: "seedSchedules",
          messageKey: "schedules:1000",
          payload: { scheduledFor: 1_000 },
        },
      ]);
      expect(evolution.state).toEqual({ lastSeededAt: 1_000 });
    });
  });

  describe("when the seed intents run", () => {
    /** @scenario "Existing projects are backfilled on a scheduled wake" */
    it("walks the topic-owning and the eligible projects", async () => {
      const repository = fakeRepository();
      const migration = makeMigration(repository);

      await runTopicModelSeed(migration)();
      await runClusteringScheduleSeed(migration)();

      expect(repository.findProjectsWithTopicsPage).toHaveBeenCalled();
      expect(repository.findEligibleProjectsPage).toHaveBeenCalled();
    });
  });

  describe("when every query rejects", () => {
    it("resolves without throwing, so the next wake retries", async () => {
      const repository = {
        ...fakeRepository(),
        findProjectsWithTopicsPage: vi.fn().mockRejectedValue(new Error("pg down")),
        findEligibleProjectsPage: vi.fn().mockRejectedValue(new Error("pg down")),
      };
      const migration = makeMigration(repository);

      await expect(runTopicModelSeed(migration)()).resolves.toBeUndefined();
      await expect(runClusteringScheduleSeed(migration)()).resolves.toBeUndefined();
    });
  });
});
