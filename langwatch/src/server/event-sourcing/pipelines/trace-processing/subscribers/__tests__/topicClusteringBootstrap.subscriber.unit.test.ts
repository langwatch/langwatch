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

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import { SPAN_RECEIVED_EVENT_TYPE } from "../../schemas/constants";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  createTopicClusteringBootstrapSubscriber,
  type TopicClusteringBootstrapSubscriberDeps,
} from "../topicClusteringBootstrap.subscriber";

const TENANT_ID = "project-123";

function createFoldState(
  attributes: Record<string, string> = {},
): TraceSummaryData {
  return { attributes } as unknown as TraceSummaryData;
}

function createEvent(
  tenantId: string,
  aggregateId = "trace-1",
): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId,
    aggregateType: "trace",
    tenantId,
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-12-14",
    data: {
      span: {},
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "STRICT",
    },
    metadata: { spanId: "span-1", traceId: aggregateId },
  } as unknown as TraceProcessingEvent;
}

function createContext(
  state: TraceSummaryData,
): TriggerContext<TraceSummaryData> {
  return { tenantId: TENANT_ID, aggregateId: "trace-1", state };
}

function createMockProjectService() {
  return {
    getById: vi.fn(),
    getWithTeam: vi.fn(),
    updateMetadata: vi.fn(),
    isFeatureEnabled: vi.fn(),
    repo: {} as any,
  };
}

describe("topicClusteringBootstrap subscriber", () => {
  let deps: TopicClusteringBootstrapSubscriberDeps;
  let projects: ReturnType<typeof createMockProjectService>;
  let bootstrapTopicClustering: ReturnType<typeof vi.fn>;

  const run = (state: TraceSummaryData) =>
    createTopicClusteringBootstrapSubscriber(deps).spec.handler(
      createEvent(TENANT_ID),
      createContext(state),
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

  describe("given a project that is ingesting traces", () => {
    /** @scenario "A project's first trace bootstraps its clustering schedule" */
    it("re-asserts the project's clustering schedule", async () => {
      await run(createFoldState());

      expect(bootstrapTopicClustering).toHaveBeenCalledWith(TENANT_ID);
    });

    it("leaves the project's onboarding metadata alone", async () => {
      // The split: clustering liveness and the onboarding latch are separate
      // subscribers now, so a schedule re-assertion never writes to Project.
      await run(createFoldState());

      expect(projects.updateMetadata).not.toHaveBeenCalled();
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
        await run(createFoldState());

        expect(bootstrapTopicClustering).toHaveBeenCalledWith(TENANT_ID);
      });
    });
  });

  describe("given a project whose only traces are seeded samples", () => {
    it("does not schedule clustering for it", async () => {
      await run(createFoldState({ "langwatch.origin": "sample" }));

      expect(bootstrapTopicClustering).not.toHaveBeenCalled();
    });

    it("does not read the project at all", async () => {
      await run(createFoldState({ "langwatch.origin": "sample" }));

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
      await run(createFoldState());

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
      await run(createFoldState());

      expect(bootstrapTopicClustering).toHaveBeenCalledWith(TENANT_ID);
    });

    it("does not report the read failure as a clustering failure", async () => {
      await run(createFoldState());

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
      await expect(run(createFoldState())).resolves.toBeUndefined();
    });

    it("records the failure as a clustering bootstrap failure", async () => {
      await run(createFoldState());

      expect(logger.error).toHaveBeenCalledTimes(1);
      const [, message] = logger.error.mock.calls[0]!;
      expect(message).toMatch(/clustering bootstrap failed/i);
    });
  });

  describe("given many traces arriving for the same project", () => {
    it("collapses them into one bootstrap job per project", async () => {
      const { spec } = createTopicClusteringBootstrapSubscriber(deps);

      const first = spec.dedupId!(createEvent(TENANT_ID, "trace-1"));
      const second = spec.dedupId!(createEvent(TENANT_ID, "trace-2"));

      expect(first).toBe(second);
    });

    it("keeps a busy project from starving another project's schedule", async () => {
      const { spec } = createTopicClusteringBootstrapSubscriber(deps);

      const mine = spec.dedupId!(createEvent(TENANT_ID, "trace-1"));
      const theirs = spec.dedupId!(createEvent("project-456", "trace-2"));

      expect(mine).not.toBe(theirs);
    });
  });
});
