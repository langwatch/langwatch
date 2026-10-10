import { LangevalsClusteringError } from "@langwatch/evaluation-contract";
import { CLUSTERING_ERROR_CODES } from "@langwatch/topic-contract";
/**
 * Regression: langevals call needs deadline to avoid outliving the lease.
 * Tests fire the deadline and observe the call's response.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchTopicsBatchClustering,
  fetchTopicsIncrementalClustering,
  TOPIC_CLUSTERING_REQUEST_DEADLINE_MS,
} from "../topic-clustering-runner.intent.ts";
import {
  classifyClusteringError,
  TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS,
} from "../topic-clustering.intent.ts";
import { fakeRunnerDeps } from "./topic-clustering-runner.fixture.ts";

const batchParams = {
  project_id: "proj-1",
  litellm_params: { model: "gpt-5-mini" },
  embeddings_litellm_params: { model: "text-embedding-3-small" },
  traces: [{ trace_id: "t-1", input: "hello", topic_id: null, subtopic_id: null }],
};

const incrementalParams = { ...batchParams, topics: [], subtopics: [] };

describe("topic clustering langevals requests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A clustering exchange that never answers on its own — only the deadline ends it. */
  function hangUntilAborted(deps: ReturnType<typeof fakeRunnerDeps>) {
    deps.evaluations.requestTopicClustering.mockImplementation(
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

  describe("given the deadline is derived from the outbox lease", () => {
    it("expires far enough inside the lease that a second replica cannot re-lease the page mid-flight", () => {
      expect(TOPIC_CLUSTERING_REQUEST_DEADLINE_MS).toBeLessThan(
        TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS,
      );
      // The remainder has to cover response handling, storeResults, and the
      // outcome write — a deadline that only just fits leaves no room.
      expect(
        TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS - TOPIC_CLUSTERING_REQUEST_DEADLINE_MS,
      ).toBeGreaterThanOrEqual(5 * 60 * 1000);
    });
  });

  describe("given a batch clustering call that never answers", () => {
    describe("when the deadline elapses", () => {
      it("aborts the request instead of running until the lease expires", async () => {
        const deps = fakeRunnerDeps();
        hangUntilAborted(deps);

        const call = fetchTopicsBatchClustering(deps, "proj-1", batchParams);
        const settled = call.catch((error) => error);

        await vi.advanceTimersByTimeAsync(TOPIC_CLUSTERING_REQUEST_DEADLINE_MS);
        await settled;

        const signal = deps.evaluations.requestTopicClustering.mock.calls[0]?.[0]?.signal;
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal.aborted).toBe(true);
      });

      it("fails the page as a clustering-service fault the outbox can retry", async () => {
        const deps = fakeRunnerDeps();
        hangUntilAborted(deps);

        const settled = fetchTopicsBatchClustering(deps, "proj-1", batchParams).catch(
          (error) => error,
        );

        await vi.advanceTimersByTimeAsync(TOPIC_CLUSTERING_REQUEST_DEADLINE_MS);
        const error = await settled;

        // Unclassified would mean INTERNAL — indistinguishable from a bug,
        // and the timeout is a known, retryable upstream condition.
        expect(classifyClusteringError(error)).toEqual({
          code: CLUSTERING_ERROR_CODES.CLUSTERING_SERVICE,
          isUserActionable: false,
        });
      });
    });
  });

  describe("given an incremental clustering call that never answers", () => {
    describe("when the deadline elapses", () => {
      it("fails the page as a clustering-service fault the outbox can retry", async () => {
        const deps = fakeRunnerDeps();
        hangUntilAborted(deps);

        const settled = fetchTopicsIncrementalClustering(deps, "proj-1", incrementalParams).catch(
          (error) => error,
        );

        await vi.advanceTimersByTimeAsync(TOPIC_CLUSTERING_REQUEST_DEADLINE_MS);
        const error = await settled;

        expect(classifyClusteringError(error)).toEqual({
          code: CLUSTERING_ERROR_CODES.CLUSTERING_SERVICE,
          isUserActionable: false,
        });
      });
    });
  });

  describe("given langevals answered a clustering call with a non-2xx", () => {
    describe("when the page runs", () => {
      it("fails the page as a clustering-service fault carrying langevals' message", async () => {
        const deps = fakeRunnerDeps();
        const refusal = new LangevalsClusteringError({
          mode: "batch",
          statusText: "Internal Server Error",
          body: "boom",
        });
        deps.evaluations.requestTopicClustering.mockRejectedValue(refusal);

        const error = await fetchTopicsBatchClustering(deps, "proj-1", batchParams).catch(
          (caught: unknown) => caught,
        );

        expect(classifyClusteringError(error)).toEqual({
          code: CLUSTERING_ERROR_CODES.CLUSTERING_SERVICE,
          isUserActionable: false,
        });
        expect(error).toMatchObject({ message: refusal.message });
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
        const deps = fakeRunnerDeps();
        deps.evaluations.requestTopicClustering.mockResolvedValue({
          kind: "clustered",
          response: body,
        });

        await expect(fetchTopicsBatchClustering(deps, "proj-1", batchParams)).resolves.toEqual({
          kind: "clustered",
          response: body,
        });
      });

      it("does not leave the deadline abort pending against a finished call", async () => {
        const deps = fakeRunnerDeps();
        await fetchTopicsBatchClustering(deps, "proj-1", batchParams);
        await vi.advanceTimersByTimeAsync(TOPIC_CLUSTERING_REQUEST_DEADLINE_MS * 2);

        const signal = deps.evaluations.requestTopicClustering.mock.calls[0]?.[0]?.signal;
        expect(signal.aborted).toBe(false);
      });
    });
  });
});
