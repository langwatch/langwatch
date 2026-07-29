import { beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

import type { TraceProcessingEvent } from "../../schemas/events";
import { createProjectMetadataSubscriber } from "../projectMetadata.subscriber";
import {
  createTopicClusteringBootstrapSubscriber,
  type TopicClusteringBootstrapSubscriberDeps,
} from "../topicClusteringBootstrap.subscriber";
import {
  createMockProjectService,
  originResolvedEvent,
  spanEvent,
  subscriberContext,
  TENANT_ID,
} from "./support/ingestEventFixtures";

describe("topicClusteringBootstrap subscriber", () => {
  let deps: TopicClusteringBootstrapSubscriberDeps;
  let projects: ReturnType<typeof createMockProjectService>;
  let bootstrapTopicClustering: ReturnType<typeof vi.fn>;

  const run = (event: TraceProcessingEvent = spanEvent()) =>
    createTopicClusteringBootstrapSubscriber(deps).handle(
      event,
      subscriberContext(),
    );

  beforeEach(() => {
    logger.error.mockClear();
    logger.warn.mockClear();
    projects = createMockProjectService();
    bootstrapTopicClustering = vi.fn().mockResolvedValue(undefined);
    deps = {
      projects: projects as any,
      bootstrapTopicClustering: bootstrapTopicClustering as any,
    };
    projects.getById.mockResolvedValue({
      id: TENANT_ID,
      firstMessage: false,
      integrated: false,
    });
  });

  describe("given the subscriber is built", () => {
    it("listens on the events that carry a project's ingest signals", () => {
      const subscriber = createTopicClusteringBootstrapSubscriber(deps);

      expect(subscriber.eventTypes).toEqual([
        "lw.obs.trace.span_received",
        "lw.obs.trace.origin_resolved",
      ]);
    });

    it("declines a seeded sample trace before a job is ever staged", () => {
      const filter =
        createTopicClusteringBootstrapSubscriber(deps).options?.enqueue?.filter;

      expect(
        filter?.(
          spanEvent({ spanAttributes: { "langwatch.origin": "sample" } }),
        ),
      ).toBe(false);
      expect(filter?.(spanEvent())).toBe(true);
    });
  });

  describe("given a project that is ingesting traces", () => {
    /** @scenario "A project's first trace bootstraps its clustering schedule" */
    it("re-asserts the project's clustering schedule", async () => {
      await run();

      expect(bootstrapTopicClustering).toHaveBeenCalledWith(TENANT_ID);
    });

    it("leaves the project's onboarding metadata alone", async () => {
      // The split: clustering liveness and the onboarding latch are separate
      // subscribers now, so a schedule re-assertion never writes to Project.
      await run();

      expect(projects.updateMetadata).not.toHaveBeenCalled();
    });

    it("re-asserts on a deferred origin resolution too", async () => {
      await run(originResolvedEvent({ origin: "application" }));

      expect(bootstrapTopicClustering).toHaveBeenCalledWith(TENANT_ID);
    });

    describe("when the project was marked integrated long ago", () => {
      beforeEach(() => {
        projects.getById.mockResolvedValue({
          id: TENANT_ID,
          firstMessage: true,
          integrated: true,
        });
      });

      it("still re-asserts the schedule", async () => {
        // The regression that made a deploy-time backfill necessary: an
        // established project returned early from the fused handler, so one
        // that lost its schedule never got it back from ingest.
        await run();

        expect(bootstrapTopicClustering).toHaveBeenCalledWith(TENANT_ID);
      });
    });
  });

  describe("given a project whose only traces are seeded samples", () => {
    it("does not schedule clustering for it", async () => {
      await run(
        spanEvent({ spanAttributes: { "langwatch.origin": "sample" } }),
      );

      expect(bootstrapTopicClustering).not.toHaveBeenCalled();
    });

    it("does not read the project at all", async () => {
      await run(
        spanEvent({ spanAttributes: { "langwatch.origin": "sample" } }),
      );

      expect(projects.getById).not.toHaveBeenCalled();
    });
  });

  describe("given the project no longer exists", () => {
    beforeEach(() => {
      projects.getById.mockResolvedValue(null);
    });

    it("does not schedule clustering for it", async () => {
      // A deleted project must not be left with a process that wakes daily
      // forever with nothing to cluster.
      await run();

      expect(bootstrapTopicClustering).not.toHaveBeenCalled();
    });
  });

  describe("given the project store is unavailable", () => {
    beforeEach(() => {
      projects.getById.mockRejectedValue(new Error("pg down"));
    });

    it("re-asserts the schedule anyway", async () => {
      // Fail forward: an unscheduled project is a silent product outage, and
      // a redundant bootstrap request is a no-op at the process. Only a
      // successful read saying the project is gone is worth skipping for.
      await run();

      expect(bootstrapTopicClustering).toHaveBeenCalledWith(TENANT_ID);
    });

    it("does not report the read failure as a clustering failure", async () => {
      await run();

      expect(logger.error).not.toHaveBeenCalled();
      const [, message] = logger.warn.mock.calls[0]!;
      expect(message).toMatch(/re-asserting its clustering schedule anyway/i);
    });
  });

  describe("given the bootstrap request fails", () => {
    beforeEach(() => {
      bootstrapTopicClustering.mockRejectedValue(new Error("store down"));
    });

    it("does not throw the job back to the queue", async () => {
      // The rate limiter takes its claim before the request succeeds and does
      // not release it, so a redelivery seconds later could not act anyway.
      // The real retry is this project's next trace after the claim expires.
      await expect(run()).resolves.toBeUndefined();
    });

    it("records the failure as a clustering bootstrap failure", async () => {
      await run();

      expect(logger.error).toHaveBeenCalledTimes(1);
      const [, message] = logger.error.mock.calls[0]!;
      expect(message).toMatch(/clustering bootstrap failed/i);
    });
  });

  describe("given many traces arriving for the same project", () => {
    const dedupOf = () => {
      const dedup =
        createTopicClusteringBootstrapSubscriber(deps).options?.deduplication;
      if (typeof dedup !== "object") {
        throw new Error("expected a deduplication config");
      }
      return dedup;
    };

    it("collapses them into one bootstrap job per project", async () => {
      const dedup = dedupOf();

      expect(dedup.makeId(spanEvent({ traceId: "trace-1" }))).toBe(
        dedup.makeId(spanEvent({ traceId: "trace-2" })),
      );
    });

    it("keeps a busy project from starving another project's schedule", async () => {
      const dedup = dedupOf();

      expect(dedup.makeId(spanEvent({ traceId: "trace-1" }))).not.toBe(
        dedup.makeId(spanEvent({ tenantId: "project-456" })),
      );
    });

    it("groups a project's traces together, so the window has something to collapse", () => {
      // The queue can only squash a duplicate staged in the same group; on the
      // default per-trace group the per-project key collapsed nothing.
      const groupKeyFn =
        createTopicClusteringBootstrapSubscriber(deps).options?.groupKeyFn;

      expect(groupKeyFn?.(spanEvent({ traceId: "trace-1" }))).toBe(
        groupKeyFn?.(spanEvent({ traceId: "trace-2" })),
      );
    });

    it("holds the window open past dispatch, so it is a rate bound and not an accident", () => {
      const dedup = dedupOf();

      expect(dedup.shouldSurviveDispatch).toBe(true);
      expect(dedup.extend).toBe(false);
    });

    it("does not collapse the project's metadata write away", async () => {
      // The two used to be one handler on one dedup key. Split, they must key
      // apart or the surviving job would silently do only half the work.
      const metadataDedup = createProjectMetadataSubscriber({
        projects: projects as any,
      }).options?.deduplication;
      if (typeof metadataDedup !== "object") {
        throw new Error("expected a deduplication config");
      }

      expect(dedupOf().makeId(spanEvent())).not.toBe(
        metadataDedup.makeId(spanEvent()),
      );
    });
  });
});
