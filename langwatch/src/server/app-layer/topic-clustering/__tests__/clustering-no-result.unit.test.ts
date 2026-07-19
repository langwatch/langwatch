/**
 * Regression: a clustering call that returned NOTHING used to wipe the
 * project's entire topic model.
 *
 * `fetchTopics*Clustering` returns undefined whenever LANGEVALS_ENDPOINT is
 * unset. `storeResults` defaulted that to empty arrays and fell through into
 * the batch-mode delete-then-recreate, so every batch run on a deployment
 * without a clustering endpoint deleted every Topic row and wrote none back —
 * and still returned a summary, which made the caller's `not_configured` skip
 * unreachable and recorded the run as completed.
 *
 * These tests drive the real code path and observe the outcome (rows deleted /
 * skip reason reported), not the shape of any message.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { assignTopicMock, stagedLangevalsFetchMock } = vi.hoisted(() => ({
  assignTopicMock: vi.fn(),
  stagedLangevalsFetchMock: vi.fn(),
}));

const mockClickHouseQuery = vi.fn();

vi.mock("~/server/db", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    topic: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    cost: { create: vi.fn() },
  },
}));

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
}));

// The deployment shape that triggers the bug: no clustering endpoint at all.
vi.mock("~/env.mjs", () => ({
  env: { LANGEVALS_ENDPOINT: undefined },
}));

vi.mock("~/server/embeddings", () => ({
  getProjectEmbeddingsModel: vi.fn().mockResolvedValue({
    model: "text-embedding-3-small",
    modelProvider: { enabled: true },
  }),
}));

vi.mock("~/server/modelProviders/resolveModelForFeature", () => ({
  resolveModelForFeature: vi.fn().mockResolvedValue({ model: "openai/gpt-5-mini" }),
}));

vi.mock("~/server/api/routers/modelProviders.utils", () => ({
  getProjectModelProviders: vi
    .fn()
    .mockResolvedValue({ openai: { enabled: true } }),
  prepareLitellmParams: vi.fn().mockResolvedValue({ model: "gpt-5-mini" }),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(() => ({ traces: { assignTopic: assignTopicMock } })),
}));

vi.mock("~/server/metrics", () => ({
  getPayloadSizeHistogram: vi.fn().mockReturnValue({ observe: vi.fn() }),
}));

vi.mock("../../../langevals/stagedFetch", () => ({
  stagedLangevalsFetch: stagedLangevalsFetchMock,
}));

import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import { clusterTopicsForProject, storeResults } from "../clustering";

function makeProject() {
  return {
    id: "proj-1",
    name: "Test Project",
    team: { organizationId: "org-1" },
  };
}

/** A full page of clusterable traces, well over the batch minimum of 10. */
function usableTraceRows(count: number) {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    TraceId: `trace-${i}`,
    ComputedInput: JSON.stringify(`User message ${i}`),
    TopicId: null,
    SubTopicId: null,
    OccurredAtMs: String(now - i * 1000),
  }));
}

describe("clusterTopicsForProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.topic.findMany).mockResolvedValue([]);
    vi.mocked(prisma.topic.deleteMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(prisma.topic.createMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(prisma.project.findUnique).mockResolvedValue(makeProject() as any);
    vi.mocked(getClickHouseClientForProject).mockResolvedValue({
      query: mockClickHouseQuery,
    } as any);
  });

  describe("given the clustering service endpoint is not configured", () => {
    describe("when a batch page of clusterable traces is run", () => {
      beforeEach(() => {
        mockClickHouseQuery.mockResolvedValueOnce({
          json: () =>
            Promise.resolve([{ total: "100", recent: "100", assigned: "0" }]),
        });
        mockClickHouseQuery.mockResolvedValueOnce({
          json: () => Promise.resolve(usableTraceRows(12)),
        });
      });

      it("deletes no topics", async () => {
        await clusterTopicsForProject("proj-1");

        expect(prisma.topic.deleteMany).not.toHaveBeenCalled();
      });

      it("reports the run as skipped for missing configuration", async () => {
        const outcome = await clusterTopicsForProject("proj-1");

        expect(outcome.skippedReason).toBe("not_configured");
        // The run must not read as productive work: reporting traces
        // processed here is what made the wipe look like a completed run.
        expect(outcome.tracesProcessed).toBe(0);
        expect(outcome.topicsCount).toBe(0);
      });

      it("stops the page walk rather than paging into the same wall", async () => {
        const outcome = await clusterTopicsForProject("proj-1");

        expect(outcome.nextSearchAfter).toBeUndefined();
      });
    });
  });
});

describe("storeResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.topic.deleteMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(prisma.topic.createMany).mockResolvedValue({ count: 0 } as any);
  });

  describe("given the clustering call returned no result", () => {
    describe("when storing in batch mode", () => {
      it("leaves the existing topic model in place", async () => {
        await storeResults("proj-1", undefined, false);

        expect(prisma.topic.deleteMany).not.toHaveBeenCalled();
        expect(prisma.topic.createMany).not.toHaveBeenCalled();
      });

      it("returns null so the caller can report a skip", async () => {
        await expect(storeResults("proj-1", undefined, false)).resolves.toBeNull();
      });
    });
  });

  describe("given the clustering call returned an empty topic set", () => {
    describe("when storing in batch mode", () => {
      it("keeps the previous topics rather than replacing them with nothing", async () => {
        // Delete and createMany are not one transaction, so deleting for an
        // empty replacement is permanent loss, not a rollback.
        await storeResults(
          "proj-1",
          { topics: [], subtopics: [], traces: [], cost: undefined } as any,
          false,
        );

        expect(prisma.topic.deleteMany).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the clustering call returned topics", () => {
    describe("when storing in batch mode", () => {
      it("replaces the topic model as before", async () => {
        await storeResults(
          "proj-1",
          {
            topics: [
              {
                id: "topic_a",
                name: "Greetings",
                centroid: [0.1, 0.2],
                p95_distance: 0.5,
              },
            ],
            subtopics: [],
            traces: [],
            cost: undefined,
          } as any,
          false,
        );

        expect(prisma.topic.deleteMany).toHaveBeenCalled();
        expect(prisma.topic.createMany).toHaveBeenCalled();
      });
    });
  });
});
