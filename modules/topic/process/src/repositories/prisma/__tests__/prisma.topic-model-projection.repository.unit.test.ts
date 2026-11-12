import { createTenantId, type StoredProjection } from "@langwatch/eventing";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import type { ProjectedTopic, TopicModelData } from "../../../eventing/topic-model.projection.ts";
import { PrismaTopicModelProjectionRepository } from "../prisma.topic-model-projection.repository.ts";

const projectId = "project-1";
const context = { aggregateId: projectId, tenantId: createTenantId(projectId) };

function topic(id: string, parentId: string | null = null): ProjectedTopic {
  return {
    id,
    name: `Topic ${id}`,
    parentId,
    embeddingsModel: "text-embedding-3-small",
    centroid: [0.1, 0.2, 0.3],
    p95Distance: 0.5,
    automaticallyGenerated: true,
    firstRecordedAt: 1_700_000_000_000,
    recordedByEventId: "event-1",
  };
}

/** Children listed first, so the store has to put the parents in ahead of them. */
function largeModel(): ProjectedTopic[] {
  const parents = Array.from({ length: 100 }, (_, i) => topic(`parent-${i}`));
  const children = Array.from({ length: 900 }, (_, i) => topic(`child-${i}`, `parent-${i % 100}`));
  return [...children, ...parents];
}

function projection(topics: ProjectedTopic[]): StoredProjection<TopicModelData> {
  return {
    state: {
      ProjectId: projectId,
      Topics: topics,
      CreatedAt: 1,
      UpdatedAt: 2,
      LastEventOccurredAt: 3,
    },
    cursor: { acceptedAt: 4, eventId: "event-1" },
    occurredAt: 3,
    createdAt: 1,
    updatedAt: 2,
    version: "v1",
  };
}

/** The bound arrays of one bulk upsert, in the statement's unnest order. */
function boundRows(values: unknown[]): { ids: string[]; parentIds: (string | null)[] } {
  const arrays = values.filter((value) => Array.isArray(value)) as unknown[][];
  return { ids: arrays[0] as string[], parentIds: arrays[2] as (string | null)[] };
}

function makeDatabase(options: { failOnUpsertChunk?: number } = {}) {
  const calls: string[] = [];
  const chunks: { ids: string[]; parentIds: (string | null)[] }[] = [];
  let upsertChunk = 0;
  const transaction = vi.fn();
  const executeRaw = vi.fn(async (_sql: TemplateStringsArray, ...values: unknown[]) => {
    upsertChunk += 1;
    if (upsertChunk === options.failOnUpsertChunk) throw new Error("connection reset");
    calls.push("upsert topics");
    chunks.push(boundRows(values));
    return boundRows(values).ids.length;
  });
  const deleteMany = vi.fn(async (args?: { where?: { parentId?: unknown } }) => {
    calls.push(args?.where?.parentId ? "delete stale children" : "delete stale topics");
    return { count: 0 };
  });
  const cursorUpsert = vi.fn(async () => {
    calls.push("move cursor");
    return {};
  });
  const database = prismaDouble({
    $transaction: transaction,
    $executeRaw: (sql, ...values) => executeRaw(sql as TemplateStringsArray, ...values),
    topic: { deleteMany },
    topicModelProjection: { upsert: cursorUpsert },
  });
  return { database, calls, chunks, transaction, executeRaw, deleteMany, cursorUpsert };
}

describe("PrismaTopicModelProjectionRepository.store", () => {
  describe("when the model holds about a thousand topics", () => {
    /** @scenario "A large topic model is stored without one long transaction" */
    it("writes in bounded chunks and never opens a transaction", async () => {
      const { database, chunks, transaction } = makeDatabase();
      const repository = PrismaTopicModelProjectionRepository.create({ database });

      await repository.store(projection(largeModel()), context);

      expect(transaction).not.toHaveBeenCalled();
      expect(chunks).toHaveLength(5);
      for (const chunk of chunks) expect(chunk.ids.length).toBeLessThanOrEqual(200);
      expect(chunks.flatMap((chunk) => chunk.ids)).toHaveLength(1000);
    });

    it("puts every parent in before any subtopic", async () => {
      const { database, chunks } = makeDatabase();
      const repository = PrismaTopicModelProjectionRepository.create({ database });

      await repository.store(projection(largeModel()), context);

      const parentIds = chunks.flatMap((chunk) => chunk.parentIds);
      const firstChild = parentIds.findIndex((parentId) => parentId !== null);
      expect(firstChild).toBe(100);
      expect(parentIds.slice(firstChild).every((parentId) => parentId !== null)).toBe(true);
    });

    /** @scenario "A large topic model is stored without one long transaction" */
    it("moves the cursor only after every topic is written and the stale ones are gone", async () => {
      const { database, calls } = makeDatabase();
      const repository = PrismaTopicModelProjectionRepository.create({ database });

      await repository.store(projection(largeModel()), context);

      expect(calls.at(-1)).toBe("move cursor");
      expect(calls.filter((call) => call === "move cursor")).toHaveLength(1);
      expect(calls.slice(-3, -1)).toEqual(["delete stale children", "delete stale topics"]);
    });
  });

  describe("when a write fails partway through", () => {
    /** @scenario "A store that fails partway leaves the cursor for a replay" */
    it("leaves the cursor unchanged so the event replays", async () => {
      const { database, cursorUpsert, deleteMany } = makeDatabase({ failOnUpsertChunk: 3 });
      const repository = PrismaTopicModelProjectionRepository.create({ database });

      await expect(repository.store(projection(largeModel()), context)).rejects.toThrow(
        "connection reset",
      );

      expect(deleteMany).not.toHaveBeenCalled();
      expect(cursorUpsert).not.toHaveBeenCalled();
    });
  });

  describe("when stale topics are removed", () => {
    /** @scenario "Stale subtopics are removed before their parents" */
    it("deletes stale children before stale parents, within the project", async () => {
      const { database, deleteMany } = makeDatabase();
      const repository = PrismaTopicModelProjectionRepository.create({ database });

      await repository.store(projection([topic("kept")]), context);

      expect(deleteMany.mock.calls.map(([args]) => args)).toEqual([
        { where: { projectId, parentId: { not: null }, id: { notIn: ["kept"] } } },
        { where: { projectId, id: { notIn: ["kept"] } } },
      ]);
    });

    /** @scenario "Stale subtopics are removed before their parents" */
    it("deletes nothing when the model holds no topics", async () => {
      const { database, deleteMany, executeRaw, cursorUpsert } = makeDatabase();
      const repository = PrismaTopicModelProjectionRepository.create({ database });

      await repository.store(projection([]), context);

      expect(deleteMany).not.toHaveBeenCalled();
      expect(executeRaw).not.toHaveBeenCalled();
      expect(cursorUpsert).toHaveBeenCalledOnce();
    });
  });
});
