/**
 * The topic model store against Postgres: the bulk upsert round-trips every
 * column, a store that fails partway converges on replay, and an id another
 * project owns is never overwritten.
 */
import { randomUUID } from "node:crypto";

import { createTenantId, type StoredProjection } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ProjectedTopic, TopicModelData } from "../../../eventing/topic-model.projection.ts";
import {
  PrismaTopicModelProjectionRepository,
  type TopicModelProjectionDatabase,
} from "../prisma.topic-model-projection.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-topic-model-store-${randomUUID()}`;
const projectId = `${namespace}-project`;
const otherProjectId = `${namespace}-other`;
const teamId = `${namespace}-team`;
const organizationId = `${namespace}-organization`;
const context = { aggregateId: projectId, tenantId: createTenantId(projectId) };

function topic(id: string, parentId: string | null, eventId: string): ProjectedTopic {
  return {
    id: `${namespace}-${id}`,
    name: `Topic ${id} from ${eventId}`,
    parentId: parentId ? `${namespace}-${parentId}` : null,
    embeddingsModel: "text-embedding-3-small",
    centroid: [0.125, -0.5, 0.75],
    p95Distance: 0.25,
    automaticallyGenerated: parentId === null,
    firstRecordedAt: 1_700_000_000_123,
    recordedByEventId: eventId,
  };
}

function model(eventId: string, size: { parents: number; children: number }): ProjectedTopic[] {
  const parents = Array.from({ length: size.parents }, (_, i) => topic(`p${i}`, null, eventId));
  const children = Array.from({ length: size.children }, (_, i) =>
    topic(`c${i}`, `p${i % size.parents}`, eventId),
  );
  return [...children, ...parents];
}

function projection(eventId: string, topics: ProjectedTopic[]): StoredProjection<TopicModelData> {
  return {
    state: {
      ProjectId: projectId,
      Topics: topics,
      CreatedAt: 1,
      UpdatedAt: 2,
      LastEventOccurredAt: 3,
    },
    cursor: { acceptedAt: 4, eventId },
    occurredAt: 3,
    createdAt: 1,
    updatedAt: 2,
    version: "v1",
  };
}

const byId = (a: ProjectedTopic, b: ProjectedTopic) => a.id.localeCompare(b.id);

describe.skipIf(!databaseUrl)("Prisma topic model projection store", () => {
  let connection: PrismaConnection;
  let failOnUpsertChunk = 0;
  let upsertChunk = 0;
  let repository: PrismaTopicModelProjectionRepository;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:topic:test:model-store"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const prisma = connection.client;
    const database: TopicModelProjectionDatabase = {
      $executeRaw: ((...args: Parameters<typeof prisma.$executeRaw>) => {
        upsertChunk += 1;
        if (upsertChunk === failOnUpsertChunk) {
          return Promise.reject(new Error("connection reset"));
        }
        return prisma.$executeRaw(...args);
      }) as typeof prisma.$executeRaw,
      topic: prisma.topic,
      topicModelProjection: prisma.topicModelProjection,
    };
    repository = PrismaTopicModelProjectionRepository.create({ database });

    await prisma.organization.create({
      data: { id: organizationId, name: namespace, slug: namespace },
    });
    await prisma.team.create({
      data: { id: teamId, organizationId, name: namespace, slug: namespace },
    });
    for (const id of [projectId, otherProjectId]) {
      await prisma.project.create({
        data: {
          id,
          teamId,
          name: id,
          slug: id,
          apiKey: id,
          language: "typescript",
          framework: "test",
        },
      });
    }
  });

  afterAll(async () => {
    if (!connection) return;
    const prisma = connection.client;
    for (const id of [projectId, otherProjectId]) {
      await prisma.topic.deleteMany({ where: { projectId: id, parentId: { not: null } } });
      await prisma.topic.deleteMany({ where: { projectId: id } });
      await prisma.topicModelProjection.deleteMany({ where: { projectId: id } });
    }
    await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  /** Fails the nth bulk upsert from now; zero fails none. */
  function failUpsertChunk(nth: number): void {
    upsertChunk = 0;
    failOnUpsertChunk = nth;
  }

  async function storedTopics(): Promise<ProjectedTopic[]> {
    const read = await repository.get(projectId, context);
    if (read.kind !== "folded") throw new Error("the projection was never stored");
    return read.projection.state.Topics.toSorted(byId);
  }

  async function cursorEventId(): Promise<string | undefined> {
    const read = await repository.get(projectId, context);
    return read.kind === "folded" ? read.projection.cursor.eventId : undefined;
  }

  describe("when a large model is stored", () => {
    /** @scenario "A large topic model is stored without one long transaction" */
    it("reads back every topic exactly as recorded", async () => {
      const topics = model("event-1", { parents: 50, children: 450 });

      await repository.store(projection("event-1", topics), context);

      expect(await storedTopics()).toEqual(topics.toSorted(byId));
      expect(await cursorEventId()).toBe("event-1");
    });
  });

  describe("when a store fails partway and the event replays", () => {
    /** @scenario "A store that fails partway leaves the cursor for a replay" */
    it("keeps the old cursor, then converges to the new model on replay", async () => {
      const next = model("event-2", { parents: 30, children: 270 });
      const previous = model("event-1", { parents: 50, children: 450 });
      await repository.store(projection("event-1", previous), context);

      failUpsertChunk(2);
      await expect(repository.store(projection("event-2", next), context)).rejects.toThrow(
        "connection reset",
      );
      expect(await cursorEventId()).toBe("event-1");

      failUpsertChunk(0);
      await repository.store(projection("event-2", next), context);

      expect(await cursorEventId()).toBe("event-2");
      expect(await storedTopics()).toEqual(next.toSorted(byId));
    });
  });

  describe("when an id belongs to another project", () => {
    /** @scenario "A topic id from another project never overwrites that project's topic" */
    it("leaves the other project's row unchanged", async () => {
      const prisma = connection.client;
      const foreignId = `${namespace}-foreign`;
      await prisma.topic.create({
        data: {
          id: foreignId,
          projectId: otherProjectId,
          name: "Theirs",
          embeddings_model: "text-embedding-3-small",
          centroid: [1, 2, 3],
          p95Distance: 0.9,
        },
      });
      const before = await prisma.topic.findUnique({
        where: { id: foreignId, projectId: otherProjectId },
      });

      const forged = { ...topic("foreign", null, "event-3"), name: "Ours" };
      await repository.store(projection("event-3", [forged]), context);

      const after = await prisma.topic.findUnique({
        where: { id: foreignId, projectId: otherProjectId },
      });
      expect(after).toEqual(before);
    });
  });
});
