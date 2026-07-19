/**
 * Regression: the langevals clustering call had no client deadline, so a slow
 * page could outlive TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS. The outbox row
 * then became visible again, a second replica leased it, and two runs
 * clustered the same page concurrently — destructive in batch mode, where
 * `storeResults` deletes the topic model before recreating it.
 *
 * These tests advance real timers to fire the deadline and observe what the
 * call actually does when it trips.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { stagedLangevalsFetchMock } = vi.hoisted(() => ({
  stagedLangevalsFetchMock: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    topic: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    cost: { create: vi.fn() },
  },
}));

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
}));

vi.mock("~/env.mjs", () => ({
  env: { LANGEVALS_ENDPOINT: "http://langevals.test" },
}));

vi.mock("~/server/embeddings", () => ({
  getProjectEmbeddingsModel: vi.fn().mockResolvedValue({
    model: "text-embedding-3-small",
    modelProvider: { enabled: true },
  }),
}));

vi.mock("~/server/api/routers/modelProviders.utils", () => ({
  getProjectModelProviders: vi
    .fn()
    .mockResolvedValue({ openai: { enabled: true } }),
  prepareLitellmParams: vi.fn().mockResolvedValue({ model: "gpt-5-mini" }),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(() => ({ traces: { assignTopic: vi.fn() } })),
}));

vi.mock("~/server/metrics", () => ({
  getPayloadSizeHistogram: vi.fn().mockReturnValue({ observe: vi.fn() }),
}));

vi.mock("../../../langevals/stagedFetch", () => ({
  stagedLangevalsFetch: stagedLangevalsFetchMock,
}));

import { TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS } from "../process-manager/topicClusteringEffects";
import {
  CLUSTERING_ERROR_CODES,
  classifyClusteringError,
} from "../clustering-error";
import {
  TOPIC_CLUSTERING_REQUEST_DEADLINE_MS,
  fetchTopicsBatchClustering,
  fetchTopicsIncrementalClustering,
} from "../clustering";

const batchParams = {
  project_id: "proj-1",
  litellm_params: { model: "gpt-5-mini" },
  embeddings_litellm_params: { model: "text-embedding-3-small" },
  traces: [{ trace_id: "t-1", input: "hello", topic_id: null, subtopic_id: null }],
} as any;

const incrementalParams = { ...batchParams, topics: [], subtopics: [] } as any;

/** A langevals call that never answers on its own — only the deadline ends it. */
function hangUntilAborted() {
  stagedLangevalsFetchMock.mockImplementation(
    ({ signal }: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(
            signal.reason ??
              Object.assign(new Error("The operation was aborted"), {
                name: "AbortError",
              }),
          );
        });
      }),
  );
}

describe("topic clustering langevals requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given the deadline is derived from the outbox lease", () => {
    it("expires far enough inside the lease that a second replica cannot re-lease the page mid-flight", () => {
      expect(TOPIC_CLUSTERING_REQUEST_DEADLINE_MS).toBeLessThan(
        TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS,
      );
      // The remainder has to cover response handling, storeResults, and the
      // outcome write — a deadline that only just fits leaves no room.
      expect(
        TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS -
          TOPIC_CLUSTERING_REQUEST_DEADLINE_MS,
      ).toBeGreaterThanOrEqual(5 * 60 * 1000);
    });
  });

  describe("given a batch clustering call that never answers", () => {
    describe("when the deadline elapses", () => {
      it("aborts the request instead of running until the lease expires", async () => {
        hangUntilAborted();

        const call = fetchTopicsBatchClustering("proj-1", batchParams);
        const settled = call.catch((error) => error);

        await vi.advanceTimersByTimeAsync(TOPIC_CLUSTERING_REQUEST_DEADLINE_MS);
        await settled;

        const signal = stagedLangevalsFetchMock.mock.calls[0]?.[0]
          ?.signal as AbortSignal;
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal.aborted).toBe(true);
      });

      it("fails the page as a clustering-service fault the outbox can retry", async () => {
        hangUntilAborted();

        const settled = fetchTopicsBatchClustering("proj-1", batchParams).catch(
          (error) => error,
        );

        await vi.advanceTimersByTimeAsync(TOPIC_CLUSTERING_REQUEST_DEADLINE_MS);
        const error = await settled;

        // Unclassified would mean INTERNAL — indistinguishable from a bug,
        // and the timeout is a known, retryable upstream condition.
        expect(classifyClusteringError(error)).toEqual({
          code: CLUSTERING_ERROR_CODES.CLUSTERING_SERVICE,
          userActionable: false,
        });
      });
    });
  });

  describe("given an incremental clustering call that never answers", () => {
    describe("when the deadline elapses", () => {
      it("fails the page as a clustering-service fault the outbox can retry", async () => {
        hangUntilAborted();

        const settled = fetchTopicsIncrementalClustering(
          "proj-1",
          incrementalParams,
        ).catch((error) => error);

        await vi.advanceTimersByTimeAsync(TOPIC_CLUSTERING_REQUEST_DEADLINE_MS);
        const error = await settled;

        expect(classifyClusteringError(error)).toEqual({
          code: CLUSTERING_ERROR_CODES.CLUSTERING_SERVICE,
          userActionable: false,
        });
      });
    });
  });

  describe("given a clustering call that answers before the deadline", () => {
    describe("when the response arrives", () => {
      it("returns the clustering result untouched", async () => {
        const body = {
          topics: [{ id: "t", name: "T", centroid: [0], p95_distance: 1 }],
          subtopics: [],
          traces: [],
          cost: null,
        };
        stagedLangevalsFetchMock.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(body),
        });

        await expect(
          fetchTopicsBatchClustering("proj-1", batchParams),
        ).resolves.toEqual(body);
      });

      it("does not leave the deadline abort pending against a finished call", async () => {
        stagedLangevalsFetchMock.mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              topics: [],
              subtopics: [],
              traces: [],
              cost: null,
            }),
        });

        await fetchTopicsBatchClustering("proj-1", batchParams);
        await vi.advanceTimersByTimeAsync(
          TOPIC_CLUSTERING_REQUEST_DEADLINE_MS * 2,
        );

        const signal = stagedLangevalsFetchMock.mock.calls[0]?.[0]
          ?.signal as AbortSignal;
        expect(signal.aborted).toBe(false);
      });
    });
  });
});
