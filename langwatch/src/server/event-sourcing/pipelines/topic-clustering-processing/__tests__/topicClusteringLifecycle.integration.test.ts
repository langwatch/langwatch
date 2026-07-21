import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { EventSourcing } from "../../../eventSourcing";
import { EventStoreClickHouse } from "../../../stores/eventStoreClickHouse";
import { EventRepositoryClickHouse } from "../../../stores/repositories/eventRepositoryClickHouse";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "../../../__tests__/integration/testContainers";
import { PrismaTopicClusteringRunProjectionRepository } from "~/server/app-layer/topic-clustering/repositories/topic-clustering-run-projection.prisma.repository";
import { PrismaTopicClusteringRunHistoryProjectionRepository } from "~/server/app-layer/topic-clustering/repositories/topic-clustering-run-history-projection.prisma.repository";
import { PrismaTopicModelProjectionRepository } from "~/server/app-layer/topic-clustering/repositories/topic-model-projection.prisma.repository";
import { PrismaTopicClusteringStatusRepository } from "~/server/app-layer/topic-clustering/repositories/topic-clustering-status.repository";
import { TopicClusteringStatusService } from "~/server/app-layer/topic-clustering/topic-clustering-status.service";
import { seedProjectTopicModel } from "~/server/app-layer/topic-clustering/seedTopicModel";
import { createTopicClusteringProcessingPipeline } from "../pipeline";

/**
 * Full-stack lifecycle tests (specs: topic-clustering/event-sourced-scheduling
 * .feature, topic-clustering/topics-source-of-truth.feature): real commands →
 * real ClickHouse event log → real fold projections → real Postgres rows read
 * back through the same repositories and services production uses. The
 * process-manager/outbox layer has its own integration test
 * (topicClusteringProcessFlow); here the outcome commands are driven the way
 * the intent executor drives them, and the assertions are on what the
 * settings page and topic surfaces actually read.
 */

const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL
);

const ns = `tclc${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;

async function waitFor<T>(
  probe: () => Promise<T | null | undefined | false>,
  label: string,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function createProject(projectId: string) {
  const organization = await prisma.organization.create({
    data: { id: `org_${projectId}`, name: ns, slug: `org-${projectId}` },
  });
  const team = await prisma.team.create({
    data: {
      id: `team_${projectId}`,
      name: ns,
      slug: `team-${projectId}`,
      organizationId: organization.id,
    },
  });
  await prisma.project.create({
    data: {
      id: projectId,
      name: ns,
      slug: `proj-${projectId}`,
      apiKey: `key-${projectId}`,
      teamId: team.id,
      language: "other",
      framework: "other",
    },
  });
}

async function destroyProject(projectId: string) {
  // Children before parents: the client-emulated Subtopics relation
  // refuses to delete a parent that still has children.
  await prisma.topic.deleteMany({
    where: { projectId, parentId: { not: null } },
  });
  await prisma.topic.deleteMany({ where: { projectId } });
  await prisma.topicModelProjection.deleteMany({ where: { projectId } });
  await prisma.topicClusteringRunProjection.deleteMany({ where: { projectId } });
  await prisma.topicClusteringRunHistoryProjection.deleteMany({
    where: { projectId },
  });
  await prisma.processManagerOutbox.deleteMany({ where: { projectId } });
  await prisma.processManagerInbox.deleteMany({ where: { projectId } });
  await prisma.processManagerInstance.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.team.deleteMany({ where: { id: `team_${projectId}` } });
  await prisma.organization.deleteMany({ where: { id: `org_${projectId}` } });
}

function topicEntry(
  id: string,
  overrides: Partial<{
    name: string;
    parentId: string | null;
    firstRecordedAt: number;
  }> = {},
) {
  return {
    id,
    name: overrides.name ?? `Topic ${id}`,
    parentId: overrides.parentId ?? null,
    embeddingsModel: "openai/text-embedding-3-small",
    centroid: [0.1, 0.2, 0.3],
    p95Distance: 0.42,
    automaticallyGenerated: true,
    ...(overrides.firstRecordedAt
      ? { firstRecordedAt: overrides.firstRecordedAt }
      : {}),
  };
}

describe.skipIf(!hasTestcontainers)(
  "topic clustering lifecycle (commands → event log → Postgres projections)",
  () => {
    let eventSourcing: EventSourcing;
    // The registered pipeline's command handles (send-capable), assigned in
    // beforeAll once the pipeline is registered.
    let commands: any;
    const projectIdFlow = `${ns}flow`;
    const projectIdMigration = `${ns}mig`;

    beforeAll(async () => {
      const clickhouse = getTestClickHouseClient();
      if (!clickhouse) throw new Error("test ClickHouse not available");

      const eventStore = new EventStoreClickHouse(
        new EventRepositoryClickHouse(async () => clickhouse),
      );
      eventSourcing = EventSourcing.createWithStores({
        eventStore,
        clickhouse: async () => clickhouse,
      });

      const pipeline = eventSourcing.register(
        createTopicClusteringProcessingPipeline({
          topicClusteringRunStatusStore:
            new PrismaTopicClusteringRunProjectionRepository(prisma),
          topicClusteringRunHistoryStore:
            new PrismaTopicClusteringRunHistoryProjectionRepository(prisma),
          topicModelStore: new PrismaTopicModelProjectionRepository(prisma),
          dispatch: {
            runPort: {
              runClusteringPage: () =>
                Promise.reject(new Error("run port unused in this test")),
            },
            commands: () => {
              throw new Error("outcome commands unused in this test");
            },
          },
        }),
      );
      commands = pipeline.commands;

      await createProject(projectIdFlow);
      await createProject(projectIdMigration);
    }, 60_000);

    afterAll(async () => {
      await destroyProject(projectIdFlow);
      await destroyProject(projectIdMigration);
      await cleanupTestData(projectIdFlow);
      await cleanupTestData(projectIdMigration);
      await eventSourcing?.close();
    }, 60_000);

    describe("when a manual run goes through its whole lifecycle", () => {
      const statusService = () =>
        new TopicClusteringStatusService(
          new PrismaTopicClusteringStatusRepository(prisma),
        );

      it("records the ask, the start, the topics, and the finish where the settings page reads them", async () => {
        const projectId = projectIdFlow;
        const runId = `manual-${ns}`;
        let at = Date.now();

        // Send: the user asks for a run.
        await commands.requestClustering.send({
          tenantId: projectId,
          occurredAt: at,
          trigger: "manual",
          requestedByUserId: `user_${ns}`,
        });
        await waitFor(async () => {
          const row = await prisma.topicClusteringRunProjection.findUnique({
            where: { projectId },
          });
          return row?.LastRequestTrigger === "manual" ? row : null;
        }, "the manual request to reach the run-status projection");

        // Wait: the ask alone reads as in flight (and only a MANUAL ask may).
        const asked = await statusService().getByProjectId({ projectId });
        expect(asked.isRunInFlight).toBe(true);
        expect(asked.isInProgress).toBe(false);

        // Start: the effect announces the page before working it.
        at += 1;
        await commands.recordClusteringRunStarted.send({
          tenantId: projectId,
          occurredAt: at,
          runId,
          page: 1,
        });
        const started = await waitFor(async () => {
          const status = await statusService().getByProjectId({ projectId });
          return status.isInProgress ? status : null;
        }, "the run start to reach the run-status projection");
        expect(started.isRunInFlight).toBe(true);

        // Record: the run's topics become an event; the Topic table is its
        // projection, rows stamped with the recording event's id.
        at += 1;
        await commands.recordTopics.send({
          tenantId: projectId,
          occurredAt: at,
          mode: "replace",
          source: "clustering",
          dedupeKey: `run:${runId}:page-1`,
          topics: [
            topicEntry(`${ns}-parent`),
            topicEntry(`${ns}-child`, { parentId: `${ns}-parent` }),
          ],
        });
        const rows = await waitFor(async () => {
          const found = await prisma.topic.findMany({
            where: { projectId },
            orderBy: { id: "asc" },
          });
          return found.length === 2 ? found : null;
        }, "the recorded topics to land in the Topic table");
        expect(rows.map((r) => r.id).sort()).toEqual([
          `${ns}-child`,
          `${ns}-parent`,
        ]);
        expect(
          rows.find((r) => r.id === `${ns}-child`)?.parentId,
        ).toBe(`${ns}-parent`);
        for (const row of rows) expect(row.lastEventId).not.toBeNull();
        expect(
          await prisma.topicModelProjection.findUnique({
            where: { projectId },
          }),
        ).not.toBeNull();

        // Finish: the terminal outcome lands in status AND bounded history.
        at += 1;
        await commands.recordClusteringRunCompleted.send({
          tenantId: projectId,
          occurredAt: at,
          runId,
          page: 1,
          mode: "batch",
          tracesProcessed: 42,
          topicsCount: 1,
          subtopicsCount: 1,
        });
        const finished = await waitFor(async () => {
          const status = await statusService().getByProjectId({ projectId });
          return status.lastRunOutcome === "completed" ? status : null;
        }, "the completion to reach the run-status projection");
        expect(finished.isInProgress).toBe(false);
        expect(finished.isRunInFlight).toBe(false);
        expect(finished.lastRunMode).toBe("batch");
        expect(finished.lastRunTracesProcessed).toBe(42);

        const history = await waitFor(async () => {
          const runs = await statusService().getRunHistoryByProjectId({
            projectId,
          });
          return runs.length > 0 ? runs : null;
        }, "the run to appear in the history read model");
        expect(history[0]).toMatchObject({
          runId,
          outcome: "completed",
          trigger: "manual",
        });

        // Re-cluster: a later batch REPLACE drops the whole previous model
        // (parents and children together) — the reconcile must survive the
        // client-emulated Subtopics relation and land the new model.
        at += 1;
        await commands.recordTopics.send({
          tenantId: projectId,
          occurredAt: at,
          mode: "replace",
          source: "clustering",
          dedupeKey: `run:${runId}-2:page-1`,
          topics: [
            topicEntry(`${ns}-parent2`),
            topicEntry(`${ns}-child2`, { parentId: `${ns}-parent2` }),
          ],
        });
        const replaced = await waitFor(async () => {
          const found = await prisma.topic.findMany({
            where: { projectId },
            select: { id: true },
          });
          return found.length === 2 &&
            found.every((r) => r.id.endsWith("2"))
            ? found
            : null;
        }, "the batch replace to reconcile the previous model away");
        expect(replaced.map((r) => r.id).sort()).toEqual([
          `${ns}-child2`,
          `${ns}-parent2`,
        ]);
      }, 60_000);
    });

    describe("when a legacy project is migrated onto the stream", () => {
      it("seeds the existing rows, skips re-seeding, merges new work, and survives a late duplicate seed", async () => {
        const projectId = projectIdMigration;
        const legacyCreatedAt = new Date(Date.now() - 30 * 24 * 60 * 60_000);

        // Pre-cutover state: rows written before event ownership, no
        // provenance, no projection cursor.
        await prisma.topic.create({
          data: {
            id: `${ns}-legacy-parent`,
            projectId,
            name: "Legacy parent",
            embeddings_model: "openai/text-embedding-3-small",
            centroid: [0.1, 0.2, 0.3],
            p95Distance: 0.4,
            automaticallyGenerated: true,
            createdAt: legacyCreatedAt,
          },
        });
        await prisma.topic.create({
          data: {
            id: `${ns}-legacy-child`,
            projectId,
            name: "Legacy child",
            parentId: `${ns}-legacy-parent`,
            embeddings_model: "openai/text-embedding-3-small",
            centroid: [0.4, 0.5, 0.6],
            p95Distance: 0.4,
            automaticallyGenerated: true,
            createdAt: legacyCreatedAt,
          },
        });

        // Seed: the migration records the legacy rows as the model's first
        // event...
        const first = await seedProjectTopicModel({
          prisma,
          recordTopics: (args) => commands.recordTopics.send(args),
          projectId,
        });
        expect(first).toBe("seeded");

        // ...and once the fold owns the model, ids/names/hierarchy are
        // untouched, ages preserved, and every row carries provenance.
        const migrated = await waitFor(async () => {
          const cursor = await prisma.topicModelProjection.findUnique({
            where: { projectId },
          });
          if (!cursor) return null;
          return prisma.topic.findMany({
            where: { projectId },
            orderBy: { id: "asc" },
          });
        }, "the seed to fold into projection ownership");
        expect(migrated.map((r) => r.id).sort()).toEqual([
          `${ns}-legacy-child`,
          `${ns}-legacy-parent`,
        ]);
        expect(
          migrated.find((r) => r.id === `${ns}-legacy-child`)?.parentId,
        ).toBe(`${ns}-legacy-parent`);
        for (const row of migrated) {
          expect(row.lastEventId).not.toBeNull();
          expect(row.createdAt.getTime()).toBe(legacyCreatedAt.getTime());
        }

        // Re-running the migration is a no-op.
        const again = await seedProjectTopicModel({
          prisma,
          recordTopics: () => {
            throw new Error("an owned project must not be re-seeded");
          },
          projectId,
        });
        expect(again).toBe("skipped");

        // Post-migration clustering extends the model through the stream.
        await commands.recordTopics.send({
          tenantId: projectId,
          occurredAt: Date.now(),
          mode: "merge",
          source: "clustering",
          dedupeKey: `run:${ns}-mig:page-1`,
          topics: [topicEntry(`${ns}-delta`)],
        });
        await waitFor(async () => {
          const count = await prisma.topic.count({ where: { projectId } });
          return count === 3 ? count : null;
        }, "the clustering delta to merge into the table");

        // A late duplicate seed (the race the fold guard closes) must not
        // replace away the delta.
        const lateSeedAt = Date.now();
        await commands.recordTopics.send({
          tenantId: projectId,
          occurredAt: lateSeedAt,
          mode: "replace",
          source: "seed",
          dedupeKey: "seed:v1-late",
          topics: [
            topicEntry(`${ns}-legacy-parent`, { name: "Legacy parent" }),
            topicEntry(`${ns}-legacy-child`, {
              name: "Legacy child",
              parentId: `${ns}-legacy-parent`,
            }),
          ],
        });
        await waitFor(async () => {
          const cursor = await prisma.topicModelProjection.findUnique({
            where: { projectId },
          });
          return cursor && cursor.OccurredAt >= lateSeedAt ? cursor : null;
        }, "the late duplicate seed to be consumed by the fold");
        const surviving = await prisma.topic.findMany({
          where: { projectId },
          select: { id: true },
        });
        expect(surviving.map((r) => r.id).sort()).toEqual([
          `${ns}-delta`,
          `${ns}-legacy-child`,
          `${ns}-legacy-parent`,
        ]);
      }, 60_000);
    });
  },
);
