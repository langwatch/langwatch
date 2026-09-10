/**
 * The annotation queue walk reads one step, not the whole queue.
 *
 * The page shows one conversation at a time, so the read behind it resolves
 * one item: its trace, its place in the queue, and the ids either side. What
 * this pins is the bound — a queue of twelve thousand costs the same read as a
 * queue of three, and no path here hands ClickHouse a list of every queued
 * trace id, which is what stopped working once queues grew.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { guardProjectId } from "~/utils/dbMultiTenancyProtection";
import { createInnerTRPCContext } from "../../trpc";
import { annotationRouter } from "../annotation";

const { mockCreate, mockGetTracesWithSpans, mockFindExistingTraceIds } =
  vi.hoisted(() => ({
    mockCreate: vi.fn(),
    mockGetTracesWithSpans: vi.fn(),
    mockFindExistingTraceIds: vi.fn(),
  }));

const mockQueueItemFindFirst = vi.fn();
const mockQueueItemFindMany = vi.fn().mockResolvedValue([]);
const mockQueueItemCount = vi.fn();
const mockAnnotationFindMany = vi.fn().mockResolvedValue([]);
const mockQueueFindMany = vi.fn().mockResolvedValue([]);

// The declared permission seam resolves its service from the App.
vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import(
    "~/test-utils/appPermissionsMock"
  );
  return appPermissionsMock();
});

vi.mock("~/server/traces/trace.service", () => ({
  TraceService: { create: mockCreate },
}));

vi.mock("~/server/traces/trace-blob-resolution.deps", () => ({
  buildTraceBlobResolutionDeps: vi.fn(() => ({})),
}));

vi.mock("~/server/traces/clickhouse-trace.service", () => ({
  ClickHouseTraceService: {
    create: () => ({ findExistingTraceIds: mockFindExistingTraceIds }),
  },
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    hasProjectPermission: vi.fn(() => Promise.resolve(true)),
    resolveProjectPermission: vi
      .fn()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
  };
});

vi.mock("../../utils", () => ({
  getUserProtectionsForProject: vi.fn().mockResolvedValue({
    canSeeCosts: true,
    canSeePiiData: true,
    canSeeTopics: true,
  }),
}));

const PROJECT_ID = "project_1";
const WALKED_ITEM = {
  id: "qi-2",
  traceId: "trace-2",
  createdAt: new Date("2026-08-01T10:00:00Z"),
  doneAt: null,
  annotationQueueId: "queue-1",
  user: null,
  createdByUser: null,
  annotationQueue: null,
};

/** The id a stale link names: finished or taken out of the queue since. */
const DEAD_LINK_ID = "qi-gone";
/**
 * The front of the queue, which is where a dead link lands. Deliberately a
 * different item than any named lookup returns, so the test can tell a
 * fallback from an ordinary hit.
 */
const FRONT_ITEM = {
  ...WALKED_ITEM,
  id: "qi-front",
  traceId: "trace-front",
};

/** How long the queue is. Far past anything a single read could carry. */
const QUEUE_LENGTH = 12_000;
/** How many sort ahead of the walked item, which is its rank less one. */
const AHEAD_OF_WALKED = 7;

/**
 * Whether a lookup asks for the id a dead link names, whatever shape the query
 * is built in: the point is which id is being asked for, not how the clause is
 * assembled, so rearranging the query does not quietly disarm the test.
 */
const asksForDeadLink = (args: { where?: unknown }) =>
  JSON.stringify(args.where ?? {}).includes(DEAD_LINK_ID);

/** Whether a Prisma call is one of the two neighbour seeks. */
const isNeighbourSeek = (args: { select?: { id?: boolean } }) =>
  args.select?.id === true;

/** The neighbour seeks are told apart by the direction they read the walk in. */
const readsTowardsFrontOfQueue = (args: {
  orderBy?: { createdAt?: string }[];
}) => args.orderBy?.[0]?.createdAt === "asc";

/**
 * One queue-item read, answered only if the real multitenancy guard lets it
 * through.
 *
 * The stub routes every `AnnotationQueueItem` call through the middleware the
 * live client runs rather than answering blindly, so these tests execute the
 * real tenancy check against the real `where` the router builds. A stub that
 * skips the guard cannot observe a walk that throws on every call in
 * production, which is exactly what shipped: the guard reads `projectId` at
 * the top level only for a model outside `SCOPED_MODELS`
 * (`~/utils/dbMultiTenancyProtection.ts:894`), so a `where` wrapped in `AND`
 * hides the tenancy predicate from it.
 */
const guardedQueueItemRead =
  (action: string, answer: (args: any) => unknown) => async (args: unknown) => {
    await guardProjectId(
      {
        model: "AnnotationQueueItem",
        action,
        args,
        dataPath: [],
        runInTransaction: false,
      } as never,
      async () => undefined,
    );
    return answer(args);
  };

function makePrismaStub(): PrismaClient {
  mockQueueItemCount
    .mockResolvedValueOnce(QUEUE_LENGTH)
    .mockResolvedValueOnce(AHEAD_OF_WALKED);
  mockQueueItemFindFirst.mockImplementation(
    async (args: {
      select?: { id?: boolean };
      orderBy?: { createdAt?: string }[];
    }) => {
      if (isNeighbourSeek(args)) {
        return readsTowardsFrontOfQueue(args) ? { id: "qi-1" } : { id: "qi-3" };
      }
      return WALKED_ITEM;
    },
  );

  return {
    annotationQueueItem: {
      findFirst: guardedQueueItemRead("findFirst", mockQueueItemFindFirst),
      findMany: guardedQueueItemRead("findMany", mockQueueItemFindMany),
      count: guardedQueueItemRead("count", mockQueueItemCount),
    },
    annotation: { findMany: mockAnnotationFindMany },
    annotationQueue: { findMany: mockQueueFindMany },
    project: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ team: { organizationId: "org_123" } }),
    },
  } as unknown as PrismaClient;
}

let caller: ReturnType<typeof annotationRouter.createCaller>;
let prisma: PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockReturnValue({ getTracesWithSpans: mockGetTracesWithSpans });
  mockGetTracesWithSpans.mockResolvedValue([
    { trace_id: "trace-2", spans: [] },
  ]);

  const ctx = createInnerTRPCContext({
    session: { user: { id: "test-user-id" }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  prisma = makePrismaStub();
  ctx.prisma = prisma;
  caller = annotationRouter.createCaller(ctx);
});

describe("given a queue far longer than one read could carry", () => {
  describe("when the reviewer opens one item of it", () => {
    it("resolves the trace of that item alone", async () => {
      await caller.getQueueWalkStep({
        projectId: PROJECT_ID,
        queueItemId: "qi-2",
      });

      expect(mockGetTracesWithSpans).toHaveBeenCalledTimes(1);
      const [, traceIds] = mockGetTracesWithSpans.mock.calls[0] ?? [];
      expect(traceIds).toEqual(["trace-2"]);
    });

    it("reads back its place in the queue and the ids either side", async () => {
      const step = await caller.getQueueWalkStep({
        projectId: PROJECT_ID,
        queueItemId: "qi-2",
      });

      expect(step.position).toBe(AHEAD_OF_WALKED + 1);
      expect(step.total).toBe(QUEUE_LENGTH);
      expect(step.previousItemId).toBe("qi-1");
      expect(step.nextItemId).toBe("qi-3");
      expect(step.queueFinished).toBe(false);
    });
  });

  describe("when the item the link names is no longer waiting", () => {
    /** @scenario "A link to an item that is no longer waiting opens the first item still waiting" */
    it("opens the first item still waiting instead of nothing", async () => {
      mockQueueItemFindFirst.mockImplementation(
        async (args: {
          select?: { id?: boolean };
          orderBy?: { createdAt?: string }[];
          where?: unknown;
        }) => {
          if (isNeighbourSeek(args)) {
            return readsTowardsFrontOfQueue(args)
              ? { id: "qi-1" }
              : { id: "qi-3" };
          }
          // Nothing waiting answers to the id the link names: it was finished
          // or taken out of the queue after the link was made. Any other
          // lookup is the walk falling back to the front of the queue, which
          // is a different item — so landing there is what this proves.
          return asksForDeadLink(args) ? null : FRONT_ITEM;
        },
      );

      const step = await caller.getQueueWalkStep({
        projectId: PROJECT_ID,
        queueItemId: DEAD_LINK_ID,
      });

      expect(step.item?.id).toBe(FRONT_ITEM.id);
    });
  });

  describe("when every trace in it has aged out", () => {
    /**
     * Reporting "done" needs proof that nothing readable is left, and the only
     * proof available is a read of the queue's trace ids — the read this whole
     * change exists to bound. Past the lookahead the walk stops asking and
     * reports unfinished instead, which keeps a reviewer looking at work that
     * cannot be read rather than sending one away while work waits.
     *
     * The cost is real and deliberate: a queue this long whose traces have all
     * expired never reports itself finished. Anything that makes this say
     * `true` has either found a cheaper proof or restored the unbounded read.
     */
    it("stops short of claiming the queue is done", async () => {
      mockGetTracesWithSpans.mockResolvedValue([]);

      const step = await caller.getQueueWalkStep({
        projectId: PROJECT_ID,
        queueItemId: "qi-2",
      });

      expect(step.queueFinished).toBe(false);
      expect(mockFindExistingTraceIds).not.toHaveBeenCalled();
    });
  });

  describe("when the reads are checked for tenancy the way the live client checks them", () => {
    /**
     * The stub only has teeth if the guard it runs can actually refuse, so
     * prove that first: a read with no tenancy predicate must be turned away.
     * Without this the three tests below would pass on a guard that had been
     * quietly disarmed.
     */
    it("refuses a queue-item read that carries no tenancy predicate", async () => {
      await expect(
        prisma.annotationQueueItem.findFirst({ where: { id: "qi-2" } }),
      ).rejects.toThrow(/requires a 'projectId'/);
    });

    describe("when the reviewer opens the item a link names", () => {
      it("resolves that item", async () => {
        const step = await caller.getQueueWalkStep({
          projectId: PROJECT_ID,
          queueItemId: "qi-2",
        });

        expect(step.item?.id).toBe(WALKED_ITEM.id);
      });
    });

    describe("when the reviewer opens the walk with no item named", () => {
      /**
       * Naming no item takes the walk down the one lookup that reads the
       * `where` as built, so every remaining read is a neighbourhood seek:
       * the count of what is ahead and the two ids either side. Anything that
       * throws here is one of those three, not the named-item lookup.
       */
      it("reads back its place and the ids either side", async () => {
        const step = await caller.getQueueWalkStep({ projectId: PROJECT_ID });

        expect(step.position).toBe(AHEAD_OF_WALKED + 1);
        expect(step.previousItemId).toBe("qi-1");
        expect(step.nextItemId).toBe("qi-3");
      });
    });
  });

  describe("when the open item's trace no longer resolves", () => {
    it("leaves the queue unfinished", async () => {
      // Nothing answers to the queued id any more: retention dropped it after
      // it was queued.
      mockGetTracesWithSpans.mockResolvedValue([]);

      const step = await caller.getQueueWalkStep({
        projectId: PROJECT_ID,
        queueItemId: "qi-2",
      });

      expect(step.item?.trace).toBeNull();
      expect(step.queueFinished).toBe(false);
    });
  });
});
