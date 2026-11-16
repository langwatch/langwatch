/**
 * The topic model store against Postgres: the bulk upsert round-trips every
 * column in any session time zone, a store that fails partway converges on
 * replay, and an id another project owns fails the store, never overwritten.
 */
import { randomUUID } from "node:crypto";

import { createTenantId, type StoredProjection } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
  skipTenantCheck,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TopicClusteringTopicsRecordedEvent } from "../../../eventing/topic-clustering.events.ts";
import {
  type ProjectedTopic,
  type TopicModelData,
  TopicModelFoldProjection,
} from "../../../eventing/topic-model.projection.ts";
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

/** A clustering event carrying the model's topics, without the times the fold resolves. */
function recordedEvent(params: {
  id: string;
  mode: "replace" | "merge";
  topics: ProjectedTopic[];
  occurredAt: number;
}): TopicClusteringTopicsRecordedEvent {
  return {
    id: params.id,
    aggregateId: projectId,
    aggregateType: "topic_clustering",
    tenantId: projectId,
    createdAt: params.occurredAt,
    occurredAt: params.occurredAt,
    type: "lw.obs.topic_clustering.topics_recorded",
    version: "2026-07-20",
    data: {
      mode: params.mode,
      source: "clustering",
      dedupeKey: `run:${params.id}:page-1`,
      topics: params.topics.map((t) => ({
        id: t.id,
        name: t.name,
        parentId: t.parentId,
        embeddingsModel: t.embeddingsModel,
        centroid: t.centroid,
        p95Distance: t.p95Distance,
        automaticallyGenerated: t.automaticallyGenerated,
      })),
    },
  } as TopicClusteringTopicsRecordedEvent;
}

describe.skipIf(!databaseUrl)("Prisma topic model projection store", () => {
  let connection: PrismaConnection;
  let failOnUpsertChunk = 0;
  let upsertChunk = 0;
  let repository: PrismaTopicModelProjectionRepository;
  let fold: TopicModelFoldProjection;

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
      $queryRaw: ((...args: Parameters<typeof prisma.$queryRaw>) =>
        prisma.$queryRaw(...args)) as typeof prisma.$queryRaw,
      topic: prisma.topic,
      topicModelProjection: prisma.topicModelProjection,
    };
    repository = PrismaTopicModelProjectionRepository.create({ database });
    fold = TopicModelFoldProjection.create({ store: repository });

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

  /** The worker's path for one event: read the stored model, fold the event, store it. */
  async function applyEvent(event: TopicClusteringTopicsRecordedEvent): Promise<void> {
    const read = await repository.get(projectId, context);
    const state = read.kind === "folded" ? read.projection.state : fold.init();
    const next = fold.handleTopicClusteringTopicsRecorded(event, state);
    await repository.store(projection(event.id, next.Topics), context);
  }

  describe("when a large model is stored", () => {
    /** @scenario "A stored topic model reads back exactly as recorded" */
    it("reads back every topic exactly as recorded", async () => {
      const topics = model("event-1", { parents: 50, children: 450 });

      await repository.store(projection("event-1", topics), context);

      expect(await storedTopics()).toEqual(topics.toSorted(byId));
      expect(await cursorEventId()).toBe("event-1");
    });
  });

  describe("when a store fails partway and the event replays through the fold", () => {
    /** @scenario "Replaying a store that failed partway converges to the new model" */
    it("keeps the old cursor, then converges for a replace and a merge", async () => {
      const events = [
        recordedEvent({
          id: `${namespace}-e1`,
          mode: "replace",
          topics: model("e1", { parents: 50, children: 450 }),
          occurredAt: 1_700_000_001_000,
        }),
        recordedEvent({
          id: `${namespace}-e2`,
          mode: "replace",
          topics: model("e2", { parents: 30, children: 270 }),
          occurredAt: 1_700_000_002_000,
        }),
        recordedEvent({
          id: `${namespace}-e3`,
          mode: "merge",
          topics: model("e3", { parents: 40, children: 260 }),
          occurredAt: 1_700_000_003_000,
        }),
      ];
      const [first, ...rest] = events;
      if (!first) throw new Error("no events");
      const stored = await repository.get(projectId, context);
      const clean = events.reduce(
        (state, event) => fold.handleTopicClusteringTopicsRecorded(event, state),
        stored.kind === "folded" ? stored.projection.state : fold.init(),
      );
      await applyEvent(first);

      for (const event of rest) {
        const before = await cursorEventId();
        failUpsertChunk(2);
        await expect(applyEvent(event)).rejects.toThrow("connection reset");
        expect(await cursorEventId()).toBe(before);

        failUpsertChunk(0);
        await applyEvent(event);
        expect(await cursorEventId()).toBe(event.id);
      }

      expect(await storedTopics()).toEqual(clean.Topics.toSorted(byId));
    });
  });

  describe("when the session runs in a time zone other than UTC", () => {
    /** @scenario "Recorded times are stored the same in any session time zone" */
    it("stores each topic's recorded time unshifted", async () => {
      const topics = model("event-tz", { parents: 2, children: 4 });

      await connection.client.$transaction(async (tx) => {
        // A session setting, not a tenant query: it touches no rows.
        await tx.$executeRaw`${skipTenantCheck({ SKIP_TENANT_CHECK: true })}SET LOCAL TIME ZONE 'Pacific/Chatham'`;
        const inZone = PrismaTopicModelProjectionRepository.create({ database: tx });
        await inZone.store(projection("event-tz", topics), context);
      });

      expect(await storedTopics()).toEqual(topics.toSorted(byId));
    });
  });

  describe("when an id belongs to another project", () => {
    /** @scenario "A topic id from another project never overwrites that project's topic" */
    it("fails the store before writing and leaves the other project's row unchanged", async () => {
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

      const cursorBefore = await cursorEventId();
      const fresh = topic("fresh", null, "event-3");
      const forged = { ...topic("foreign", null, "event-3"), name: "Ours" };
      await expect(
        repository.store(projection("event-3", [fresh, forged]), context),
      ).rejects.toThrow("another project owns 1 of these topic ids");

      expect(cursorBefore).toBeDefined();
      expect(await cursorEventId()).toBe(cursorBefore);
      expect(await prisma.topic.findUnique({ where: { id: fresh.id, projectId } })).toBeNull();

      const after = await prisma.topic.findUnique({
        where: { id: foreignId, projectId: otherProjectId },
      });
      expect(after).toEqual(before);
    });
  });
});
