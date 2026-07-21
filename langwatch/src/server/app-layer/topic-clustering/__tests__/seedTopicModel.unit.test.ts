import { type PrismaClient } from "@prisma/client";
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
 *
 * The fix enumerates the fleet by paging the GLOBAL `Project` model — which
 * the guard exempts — filtered to the projects that own Topic rows. No raw
 * SQL and no tenancy opt-out: the whole seed stays on the guarded model API.
 */

/** The middleware params Prisma hands the guard for a model-API call. */
const modelParams = (model: string, action: string, args: unknown) => ({
  model,
  action,
  args,
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
 * The projection-ownership reads, shared by both stubs below: the per-project
 * `findUnique` the seed uses to decide "already owned?" and the per-page
 * `findMany` batch that front-runs it. Both still run the real guard.
 */
const topicModelProjectionMock = (ownedProjectIds: Set<string>) => ({
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
});

/**
 * A Prisma stub that enforces the real tenancy guard on every call and
 * serves `topicPages` to the fleet-wide Project walk in order.
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
  const pageArgs: Array<{ where?: any }> = [];
  let pageIndex = 0;

  const prisma = {
    project: {
      findMany: async (args: { where?: any }) => {
        pageArgs.push(args);
        await guard(modelParams("Project", "findMany", args));
        const page = topicPages[pageIndex] ?? [];
        pageIndex++;
        // `select: { id: true }` shape — the seed maps these to projectIds.
        return page.map((id) => ({ id }));
      },
    },
    topic: {
      findMany: async (args: { where: { projectId: string } }) => {
        await guard(modelParams("Topic", "findMany", args));
        return topicsByProject[args.where.projectId] ?? [];
      },
    },
    topicModelProjection: topicModelProjectionMock(ownedProjectIds),
  } as unknown as PrismaClient;

  return { prisma, pageArgs };
};

/**
 * A faithful in-memory Postgres for Project/Topic: `project.findMany`
 * implements the exact contract the seed relies on — the `topics: { some }`
 * EXISTS filter, keyset pagination by `id`, ascending order, and `take`. Ids
 * are compared lexically, as Postgres compares the nanoid PK. This lets a test
 * drive the seed over the real PAGE_SIZE walk and assert it enumerates every
 * project that owns topics, exactly once: a botched cursor (a skipped or
 * double-counted boundary row) fails it. Every call still runs the real guard.
 */
const fakeDbStub = ({
  projectsWithTopics,
  projectsWithoutTopics = [],
  ownedProjectIds = new Set<string>(),
}: {
  projectsWithTopics: string[];
  projectsWithoutTopics?: string[];
  ownedProjectIds?: Set<string>;
}) => {
  const topicsByProject = new Map<string, ReturnType<typeof topicRow>[]>(
    projectsWithTopics.map((id) => [id, [topicRow(`t-${id}`, id)]]),
  );
  const allIds = [...projectsWithTopics, ...projectsWithoutTopics];

  const prisma = {
    project: {
      findMany: async (args: any) => {
        await guard(modelParams("Project", "findMany", args));
        const gt: string | undefined = args?.where?.id?.gt;
        const requireTopics = Boolean(args?.where?.topics);
        const matched = allIds
          .filter((id) => (requireTopics ? topicsByProject.has(id) : true))
          .filter((id) => gt === undefined || id > gt)
          .sort();
        return matched
          .slice(0, args?.take ?? matched.length)
          .map((id) => ({ id }));
      },
    },
    topic: {
      findMany: async (args: { where: { projectId: string } }) => {
        await guard(modelParams("Topic", "findMany", args));
        return topicsByProject.get(args.where.projectId) ?? [];
      },
    },
    topicModelProjection: topicModelProjectionMock(ownedProjectIds),
  } as unknown as PrismaClient;

  return { prisma };
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

      it("pages the global Project model, keeping only projects that own topics", async () => {
        const { prisma, pageArgs } = guardedPrismaStub({
          topicPages: [[]],
          topicsByProject: {},
        });

        await seedTopicModelHistory({
          prisma,
          redis: null,
          recordTopics: vi.fn().mockResolvedValue(undefined),
        });

        // A `topics: { some }` EXISTS filter selects the fleet — the same set
        // as a distinct-projectId scan of Topic, but off the global model…
        expect(pageArgs[0]?.where).toEqual(
          expect.objectContaining({ topics: { some: {} } }),
        );
        // …and it carries no projectId of its own: Project is global, so the
        // guard never asks for one (that is the whole reason this walk works).
        expect(pageArgs[0]?.where?.projectId).toBeUndefined();
      });
    });
  });

  describe("given the fleet spans more than one page", () => {
    describe("when the walk advances", () => {
      it("pages on a projectId cursor the guard accepts", async () => {
        const recordTopics = vi.fn().mockResolvedValue(undefined);
        const { prisma, pageArgs } = guardedPrismaStub({
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
        expect(pageArgs).toHaveLength(3);
        // The second page cursors past the last id of the first.
        expect(pageArgs[1]?.where?.id).toEqual({ gt: "p1" });
      });
    });
  });

  describe("given a fleet larger than one page", () => {
    describe("when the boot seed pass walks it end to end", () => {
      it("records every project that owns topics, exactly once, and skips the rest", async () => {
        // 450 topic-owning projects + 50 topic-less, ids zero-padded so their
        // lexical order is the keyset order the seed pages by. 450 > PAGE_SIZE
        // (200), so the walk must cross page boundaries and still terminate —
        // exactly where a botched cursor would skip or double-count a project.
        const withTopics: string[] = [];
        const withoutTopics: string[] = [];
        for (let i = 0; i < 500; i++) {
          const id = `p${String(i).padStart(4, "0")}`;
          (i % 10 === 0 ? withoutTopics : withTopics).push(id);
        }

        const recorded: string[] = [];
        const recordTopics = vi.fn(async (cmd: { tenantId: string }) => {
          recorded.push(cmd.tenantId);
        });
        const { prisma } = fakeDbStub({
          projectsWithTopics: withTopics,
          projectsWithoutTopics: withoutTopics,
        });

        const summary = await seedTopicModelHistory({
          prisma,
          redis: null,
          recordTopics,
        });

        // Nothing skipped: exactly the topic-owning projects, all of them.
        expect([...recorded].sort()).toEqual([...withTopics].sort());
        // No duplicates — a cursor that re-served a boundary row trips this.
        expect(new Set(recorded).size).toBe(recorded.length);
        // No topic-less project leaked in.
        expect(recorded.filter((id) => withoutTopics.includes(id))).toEqual([]);
        expect(summary).toEqual({ seeded: withTopics.length, skipped: 0 });
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

  describe("given the tenancy guard validates the page query", () => {
    describe("when it is the unscoped Topic walk the seed used to issue", () => {
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

    describe("when it is the global Project page the seed now issues", () => {
      it("accepts it, because Project is a guard-exempt global model", async () => {
        await expect(
          guard(
            modelParams("Project", "findMany", {
              where: { topics: { some: {} } },
              select: { id: true },
              orderBy: { id: "asc" },
              take: 200,
            }),
          ),
        ).resolves.toBeUndefined();
      });
    });
  });
});
