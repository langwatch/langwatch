import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { guardProjectId } from "~/utils/dbMultiTenancyProtection";
import { seedTopicModelHistory } from "../seedTopicModel";

/**
 * Unit tests for the ADR-051 one-time topic-model seed.
 *
 * The Prisma stub here routes EVERY call through the real `guardProjectId`
 * middleware rather than answering blindly. That is the point: the seed
 * shipped in #5930 paged over the project-scoped `Topic` model with no
 * projectId predicate on its first page, so the guard threw on every worker
 * boot and no project was ever seeded ("Topic model seed pass failed; the
 * next boot retries", forever). A stub that skips the guard cannot observe
 * that failure, so these tests run it for real.
 */

/** The middleware params Prisma hands the guard for a model-API call. */
const modelParams = (model: string, action: string, args: unknown) => ({
  model,
  action,
  args,
  dataPath: [],
  runInTransaction: false,
});

/**
 * Prisma exposes raw SQL to the middleware as a `query` string; the guard
 * reads the tenancy predicate (or the `-- @tenancy:` opt-out) out of it.
 */
const rawParams = (sql: Prisma.Sql) => ({
  model: undefined,
  action: "queryRaw",
  args: { query: sql.text },
  dataPath: [],
  runInTransaction: false,
});

const guard = (params: unknown) =>
  guardProjectId(params as never, async () => undefined);

const topicRow = (id: string, projectId: string) => ({
  id,
  projectId,
  name: `topic-${id}`,
  parentId: null,
  embeddings_model: "openai/text-embedding-3-small",
  centroid: [0.1, 0.2],
  p95Distance: 0.5,
  automaticallyGenerated: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
});

/**
 * A Prisma stub that enforces the real tenancy guard on every call and
 * serves `topicPages` to the cross-tenant projectId walk in order.
 */
const guardedPrismaStub = ({
  topicPages,
  topicsByProject,
  ownedProjectIds = new Set<string>(),
}: {
  topicPages: string[][];
  topicsByProject: Record<string, ReturnType<typeof topicRow>[]>;
  ownedProjectIds?: Set<string>;
}) => {
  const rawQueries: string[] = [];
  let pageIndex = 0;

  const prisma = {
    $queryRaw: async (sql: Prisma.Sql) => {
      rawQueries.push(sql.text);
      await guard(rawParams(sql));
      const page = topicPages[pageIndex] ?? [];
      pageIndex++;
      return page.map((projectId) => ({ projectId }));
    },
    topic: {
      findMany: async (args: { where: { projectId: string } }) => {
        await guard(modelParams("Topic", "findMany", args));
        return topicsByProject[args.where.projectId] ?? [];
      },
    },
    topicModelProjection: {
      findUnique: async (args: { where: { projectId: string } }) => {
        await guard(modelParams("TopicModelProjection", "findUnique", args));
        return ownedProjectIds.has(args.where.projectId)
          ? { id: `cursor-${args.where.projectId}` }
          : null;
      },
      findMany: async (args: { where: { projectId: { in: string[] } } }) => {
        await guard(modelParams("TopicModelProjection", "findMany", args));
        return args.where.projectId.in
          .filter((projectId) => ownedProjectIds.has(projectId))
          .map((projectId) => ({ projectId }));
      },
    },
  } as unknown as PrismaClient;

  return { prisma, rawQueries };
};

describe("seedTopicModelHistory", () => {
  describe("given projects still hold pre-ownership Topic rows", () => {
    describe("when the boot seed pass runs", () => {
      it("walks the fleet without tripping the multitenancy guard", async () => {
        const recordTopics = vi.fn().mockResolvedValue(undefined);
        const { prisma } = guardedPrismaStub({
          topicPages: [["p1", "p2"], []],
          topicsByProject: {
            p1: [topicRow("t1", "p1")],
            p2: [topicRow("t2", "p2")],
          },
        });

        const summary = await seedTopicModelHistory({
          prisma,
          redis: null,
          recordTopics,
        });

        expect(summary).toEqual({ seeded: 2, skipped: 0 });
        expect(recordTopics).toHaveBeenCalledTimes(2);
      });

      it("records each project's topics against its own tenant", async () => {
        const recordTopics = vi.fn().mockResolvedValue(undefined);
        const { prisma } = guardedPrismaStub({
          topicPages: [["p1"], []],
          topicsByProject: { p1: [topicRow("t1", "p1")] },
        });

        await seedTopicModelHistory({ prisma, redis: null, recordTopics });

        expect(recordTopics).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: "p1",
            mode: "replace",
            source: "seed",
            dedupeKey: "seed:v1",
          }),
        );
      });

      it("carries the guard's opt-out marker on the cross-tenant walk", async () => {
        const { prisma, rawQueries } = guardedPrismaStub({
          topicPages: [[]],
          topicsByProject: {},
        });

        await seedTopicModelHistory({
          prisma,
          redis: null,
          recordTopics: vi.fn().mockResolvedValue(undefined),
        });

        expect(rawQueries[0]).toContain("@tenancy:");
      });
    });
  });

  describe("given the fleet spans more than one page", () => {
    describe("when the walk advances", () => {
      it("pages on a projectId cursor the guard accepts", async () => {
        const recordTopics = vi.fn().mockResolvedValue(undefined);
        const { prisma, rawQueries } = guardedPrismaStub({
          topicPages: [["p1"], ["p2"], []],
          topicsByProject: {
            p1: [topicRow("t1", "p1")],
            p2: [topicRow("t2", "p2")],
          },
        });

        const summary = await seedTopicModelHistory({
          prisma,
          redis: null,
          recordTopics,
        });

        expect(summary.seeded).toBe(2);
        expect(rawQueries).toHaveLength(3);
        expect(rawQueries[1]).toContain('"projectId" >');
      });
    });
  });

  describe("given the projection already owns a project's model", () => {
    describe("when the pass reaches it", () => {
      it("skips that project instead of re-seeding it", async () => {
        const recordTopics = vi.fn().mockResolvedValue(undefined);
        const { prisma } = guardedPrismaStub({
          topicPages: [["p1", "p2"], []],
          topicsByProject: {
            p1: [topicRow("t1", "p1")],
            p2: [topicRow("t2", "p2")],
          },
          ownedProjectIds: new Set(["p1"]),
        });

        const summary = await seedTopicModelHistory({
          prisma,
          redis: null,
          recordTopics,
        });

        expect(summary).toEqual({ seeded: 1, skipped: 1 });
        expect(recordTopics).toHaveBeenCalledTimes(1);
        expect(recordTopics).toHaveBeenCalledWith(
          expect.objectContaining({ tenantId: "p2" }),
        );
      });
    });
  });

  describe("given the guard sees the unscoped page query the seed used to issue", () => {
    describe("when that query is validated", () => {
      it("rejects it, which is why the seed failed on every boot", async () => {
        await expect(
          guard(
            modelParams("Topic", "findMany", {
              distinct: ["projectId"],
              select: { projectId: true },
              orderBy: { projectId: "asc" },
              take: 200,
            }),
          ),
        ).rejects.toThrow(/requires a 'projectId' or 'projectId.in'/);
      });
    });
  });
});
