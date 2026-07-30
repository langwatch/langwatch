import { HandledError } from "@langwatch/handled-error";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnnotationRepository } from "../annotation.repository";
import {
  ANNOTATION_QUEUE_WRITE_CONCURRENCY,
  AnnotationService,
} from "../annotation.service";

/**
 * Counts how many writes the service has in flight at any instant.
 *
 * The bound is only observable while a write is unfinished, so each fake
 * upsert parks for a tick before resolving. `peak` is the highest the counter
 * ever reached — the number the fan-out is actually allowed to reach into the
 * connection pool with.
 */
function createWriteTracker() {
  const state = { inFlight: 0, peak: 0, calls: 0 };

  const track = () =>
    vi.fn(async () => {
      state.inFlight += 1;
      state.calls += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      state.inFlight -= 1;
    });

  return { state, track };
}

function createRepository({
  upsertQueueItemForQueue,
  upsertQueueItemForUser,
  queueCount,
  userCount,
}: {
  upsertQueueItemForQueue?: AnnotationRepository["upsertQueueItemForQueue"];
  upsertQueueItemForUser?: AnnotationRepository["upsertQueueItemForUser"];
  queueCount?: number;
  userCount?: number;
} = {}): AnnotationRepository {
  return {
    findProjectOrganizationId: vi.fn().mockResolvedValue("org_1"),
    countAnnotationQueues: vi
      .fn()
      .mockImplementation(({ queueIds }: { queueIds: string[] }) =>
        Promise.resolve(queueCount ?? queueIds.length),
      ),
    countOrganizationUsers: vi
      .fn()
      .mockImplementation(({ userIds }: { userIds: string[] }) =>
        Promise.resolve(userCount ?? userIds.length),
      ),
    upsertQueueItemForQueue:
      upsertQueueItemForQueue ?? vi.fn().mockResolvedValue(undefined),
    upsertQueueItemForUser:
      upsertQueueItemForUser ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as AnnotationRepository;
}

const traceIds = (count: number) =>
  Array.from({ length: count }, (_, index) => `trace_${index}`);

describe("AnnotationService.enqueueTracesForAnnotators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given several traces and several annotators", () => {
    /** @scenario "Every selected trace is assigned to every chosen annotator" */
    it("writes one queue item per trace-and-annotator pair", async () => {
      const upsertQueueItemForQueue = vi.fn().mockResolvedValue(undefined);
      const upsertQueueItemForUser = vi.fn().mockResolvedValue(undefined);
      const service = new AnnotationService(
        createRepository({ upsertQueueItemForQueue, upsertQueueItemForUser }),
      );

      await service.enqueueTracesForAnnotators({
        traceIds: traceIds(3),
        projectId: "project_1",
        annotators: ["queue-q1", "user-u1"],
        userId: "creator_1",
      });

      expect(upsertQueueItemForQueue).toHaveBeenCalledTimes(3);
      expect(upsertQueueItemForUser).toHaveBeenCalledTimes(3);
      expect(upsertQueueItemForQueue).toHaveBeenCalledWith({
        projectId: "project_1",
        traceId: "trace_0",
        annotationQueueId: "q1",
        createdByUserId: "creator_1",
      });
    });
  });

  describe("when the same annotator appears twice in one request", () => {
    /** @scenario "A repeated annotator is assigned once, not twice" */
    it("writes one queue item per trace for that annotator", async () => {
      const upsertQueueItemForQueue = vi.fn().mockResolvedValue(undefined);
      const service = new AnnotationService(
        createRepository({ upsertQueueItemForQueue }),
      );

      await service.enqueueTracesForAnnotators({
        traceIds: traceIds(2),
        projectId: "project_1",
        annotators: ["queue-q1", "queue-q1"],
        userId: "creator_1",
      });

      expect(upsertQueueItemForQueue).toHaveBeenCalledTimes(2);
    });
  });

  describe("when a trace is assigned to an annotator it already finished for", () => {
    /** @scenario "Re-assigning a completed trace re-opens its queue item" */
    it("re-opens the existing item rather than creating a second one", async () => {
      const upsertQueueItemForQueue = vi.fn().mockResolvedValue(undefined);
      const service = new AnnotationService(
        createRepository({ upsertQueueItemForQueue }),
      );

      await service.enqueueTracesForAnnotators({
        traceIds: ["trace_0"],
        projectId: "project_1",
        annotators: ["queue-q1"],
        userId: "creator_1",
      });

      // The repository upserts on the (trace, queue, project) key and clears
      // `doneAt` on the update branch; a second row for the same pair is
      // impossible by construction rather than by convention.
      expect(upsertQueueItemForQueue).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a bulk assignment fans out far more writes than the bound", () => {
    /** @scenario "A bulk assignment never runs more writes at once than the bound" */
    it("keeps peak in-flight writes at the bound while completing them all", async () => {
      const { state, track } = createWriteTracker();
      const service = new AnnotationService(
        createRepository({
          upsertQueueItemForQueue: track(),
          upsertQueueItemForUser: track(),
        }),
      );

      await service.enqueueTracesForAnnotators({
        traceIds: traceIds(40),
        projectId: "project_1",
        annotators: ["queue-q1", "queue-q2", "user-u1"],
        userId: "creator_1",
      });

      expect(state.calls).toBe(120);
      expect(state.inFlight).toBe(0);
      // Load-bearing as an equality: were the bound widened past the work,
      // peak would climb to 120 and this would fail rather than shrug.
      expect(state.peak).toBe(ANNOTATION_QUEUE_WRITE_CONCURRENCY);
      expect(state.peak).toBeLessThan(state.calls);
    });
  });

  describe("when one annotator belongs to a different project", () => {
    /** @scenario "An annotator from another project assigns nothing at all" */
    it("writes nothing for any trace in the request", async () => {
      const upsertQueueItemForQueue = vi.fn().mockResolvedValue(undefined);
      const upsertQueueItemForUser = vi.fn().mockResolvedValue(undefined);
      const service = new AnnotationService(
        createRepository({
          upsertQueueItemForQueue,
          upsertQueueItemForUser,
          queueCount: 0,
        }),
      );

      await expect(
        service.enqueueTracesForAnnotators({
          traceIds: traceIds(3),
          projectId: "project_1",
          annotators: ["queue-foreign", "user-u1"],
          userId: "creator_1",
        }),
      ).rejects.toThrow();

      expect(upsertQueueItemForQueue).not.toHaveBeenCalled();
      expect(upsertQueueItemForUser).not.toHaveBeenCalled();
    });
  });

  describe("when an annotator names neither a queue nor a person", () => {
    /** @scenario "An annotator that names neither a queue nor a person is refused by code" */
    it("fails with the invalid_annotator_reference code and writes nothing", async () => {
      const upsertQueueItemForQueue = vi.fn().mockResolvedValue(undefined);
      const service = new AnnotationService(
        createRepository({ upsertQueueItemForQueue }),
      );

      const error = await service
        .enqueueTracesForAnnotators({
          traceIds: ["trace_0"],
          projectId: "project_1",
          annotators: ["nonsense-annotator"],
          userId: "creator_1",
        })
        .catch((caught: unknown) => caught);

      expect(HandledError.isHandled(error)).toBe(true);
      expect((error as HandledError).code).toBe("invalid_annotator_reference");
      expect((error as HandledError).fault).toBe("customer");
      expect(upsertQueueItemForQueue).not.toHaveBeenCalled();
    });

    it("refuses a prefix with nothing after it", async () => {
      const service = new AnnotationService(createRepository());

      const error = await service
        .enqueueTracesForAnnotators({
          traceIds: ["trace_0"],
          projectId: "project_1",
          annotators: ["queue-"],
          userId: "creator_1",
        })
        .catch((caught: unknown) => caught);

      expect((error as HandledError).code).toBe("invalid_annotator_reference");
    });
  });
});
