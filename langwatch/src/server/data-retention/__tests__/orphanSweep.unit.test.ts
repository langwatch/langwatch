import { describe, expect, it, vi } from "vitest";
import { OrphanSweepService } from "../orphan-sweep/orphanSweep.service";
import { InMemoryOrphanCursorStore } from "../orphan-sweep/orphanSweepCursor.store";
import { createRetentionOrphanSweepReactor } from "../orphan-sweep/retentionOrphanSweep.reactor";

describe("OrphanSweepService", () => {
  describe("sweepProject()", () => {
    /** @scenario Proactive orphan sweep removes discovered orphan records */
    it("discovers candidate trace ids and cleans those missing from ClickHouse", async () => {
      const repository = {
        findCandidateTraceIds: vi
          .fn()
          .mockResolvedValue({ traceIds: ["missing", "live"], nextCursor: null }),
        deleteAnnotations: vi.fn().mockResolvedValue(1),
        deleteAnnotationQueueItems: vi.fn().mockResolvedValue(0),
        deletePublicShares: vi.fn().mockResolvedValue(1),
        nullifyTriggerSentTraceIds: vi.fn().mockResolvedValue(0),
        deletePinnedTraces: vi.fn().mockResolvedValue(0),
      };
      const service = new OrphanSweepService(
        repository as any,
        async () =>
          ({
            query: vi.fn().mockResolvedValue({
              json: async () => [{ TraceId: "live" }],
            }),
          }) as any,
      );

      await service.sweepProject({ projectId: "project-1" });

      expect(repository.deleteAnnotations).toHaveBeenCalledWith({
        projectId: "project-1",
        traceIds: ["missing"],
      });
      expect(repository.deletePublicShares).toHaveBeenCalledWith({
        projectId: "project-1",
        traceIds: ["missing"],
      });
    });

    /** @scenario Failed proactive orphan sweep can be retried */
    it("reports cleanup failures so the caller can retry", async () => {
      const repository = {
        findCandidateTraceIds: vi
          .fn()
          .mockResolvedValue({ traceIds: ["missing"], nextCursor: null }),
        deleteAnnotations: vi
          .fn()
          .mockRejectedValue(new Error("postgres unavailable")),
        deleteAnnotationQueueItems: vi.fn().mockResolvedValue(0),
        deletePublicShares: vi.fn().mockResolvedValue(0),
        nullifyTriggerSentTraceIds: vi.fn().mockResolvedValue(0),
        deletePinnedTraces: vi.fn().mockResolvedValue(0),
      };
      const service = new OrphanSweepService(
        repository as any,
        async () =>
          ({
            query: vi.fn().mockResolvedValue({
              json: async () => [],
            }),
          }) as any,
      );

      await expect(
        service.sweepProject({ projectId: "project-1" }),
      ).rejects.toThrow(/Failed to clean orphaned PG records/);
    });

    /** @scenario Proactive orphan sweep advances past a fully-live first page */
    it("pages past a fully-live first page to clean an orphan on a later page", async () => {
      // First page: every candidate is live in CH, so nothing is cleaned —
      // but the cursor must advance. Second page surfaces the real orphan.
      const findCandidateTraceIds = vi
        .fn()
        .mockResolvedValueOnce({
          traceIds: ["live-1", "live-2"],
          nextCursor: { annotationId: "ann-2" },
        })
        .mockResolvedValueOnce({
          traceIds: ["missing"],
          nextCursor: null,
        });
      const repository = {
        findCandidateTraceIds,
        deleteAnnotations: vi.fn().mockResolvedValue(1),
        deleteAnnotationQueueItems: vi.fn().mockResolvedValue(0),
        deletePublicShares: vi.fn().mockResolvedValue(0),
        nullifyTriggerSentTraceIds: vi.fn().mockResolvedValue(0),
        deletePinnedTraces: vi.fn().mockResolvedValue(0),
      };
      // CH says live-1/live-2 exist; "missing" does not.
      const service = new OrphanSweepService(
        repository as any,
        async () =>
          ({
            query: vi.fn().mockResolvedValue({
              json: async () => [{ TraceId: "live-1" }, { TraceId: "live-2" }],
            }),
          }) as any,
      );

      await service.sweepProject({ projectId: "project-1" });

      expect(findCandidateTraceIds).toHaveBeenCalledTimes(2);
      expect(findCandidateTraceIds).toHaveBeenLastCalledWith({
        projectId: "project-1",
        limit: 1000,
        cursor: { annotationId: "ann-2" },
      });
      expect(repository.deleteAnnotations).toHaveBeenCalledTimes(1);
      expect(repository.deleteAnnotations).toHaveBeenCalledWith({
        projectId: "project-1",
        traceIds: ["missing"],
      });
    });

    /**
     * Regression: the in-process cursor reset between sweep runs, so any
     * project with more candidates than MAX_SWEEP_PAGES × CANDIDATE_LIMIT
     * (100k) would restart at the beginning each run and starve the tail.
     * The persistent cursor must survive across runs.
     */
    it("resumes from the persisted cursor on the next sweep when the page cap was hit", async () => {
      // First sweep: every page returns a full page worth of trace ids AND
      // a nextCursor. Effectively unbounded — sweep walks until the cap.
      let callIndex = 0;
      const repository = {
        findCandidateTraceIds: vi.fn().mockImplementation(({ cursor }) => {
          callIndex++;
          return Promise.resolve({
            traceIds: [`trace-${callIndex}`],
            // Return a cursor that advances each call.
            nextCursor: { annotationId: `cursor-${callIndex}` },
            _receivedCursor: cursor,
          });
        }),
        deleteAnnotations: vi.fn().mockResolvedValue(0),
        deleteAnnotationQueueItems: vi.fn().mockResolvedValue(0),
        deletePublicShares: vi.fn().mockResolvedValue(0),
        nullifyTriggerSentTraceIds: vi.fn().mockResolvedValue(0),
        deletePinnedTraces: vi.fn().mockResolvedValue(0),
      };
      const cursorStore = new InMemoryOrphanCursorStore();
      const service = new OrphanSweepService(
        repository as any,
        async () =>
          ({
            query: vi.fn().mockResolvedValue({ json: async () => [] }),
          }) as any,
        cursorStore,
      );

      // Run 1 — page cap should trigger, cursor persisted.
      await service.sweepProject({ projectId: "project-1" });
      const persistedAfterFirst = await cursorStore.load("project-1");
      expect(persistedAfterFirst).toBeDefined();
      expect(persistedAfterFirst).toEqual(
        expect.objectContaining({ annotationId: expect.any(String) }),
      );

      // Run 2 — sweep should resume from the persisted cursor, not start fresh.
      const callsBeforeRun2 = repository.findCandidateTraceIds.mock.calls.length;
      await service.sweepProject({ projectId: "project-1" });

      const firstCallOfRun2 =
        repository.findCandidateTraceIds.mock.calls[callsBeforeRun2]!;
      expect(firstCallOfRun2[0].cursor).toEqual(persistedAfterFirst);
    });

    /** When the sweep drains every source (nextCursor=null) the persisted
     *  cursor is cleared so the next sweep starts fresh. */
    it("clears the persisted cursor once every source is drained", async () => {
      const repository = {
        findCandidateTraceIds: vi.fn().mockResolvedValue({
          traceIds: ["missing"],
          nextCursor: null,
        }),
        deleteAnnotations: vi.fn().mockResolvedValue(0),
        deleteAnnotationQueueItems: vi.fn().mockResolvedValue(0),
        deletePublicShares: vi.fn().mockResolvedValue(0),
        nullifyTriggerSentTraceIds: vi.fn().mockResolvedValue(0),
        deletePinnedTraces: vi.fn().mockResolvedValue(0),
      };
      const cursorStore = new InMemoryOrphanCursorStore();
      await cursorStore.save("project-1", { annotationId: "stale" });
      const service = new OrphanSweepService(
        repository as any,
        async () =>
          ({
            query: vi.fn().mockResolvedValue({ json: async () => [] }),
          }) as any,
        cursorStore,
      );

      await service.sweepProject({ projectId: "project-1" });

      expect(await cursorStore.load("project-1")).toBeUndefined();
    });
  });
});

describe("createRetentionOrphanSweepReactor()", () => {
  describe("given the reactor is configured", () => {
    describe("when the reactor's options are inspected", () => {
      it("returns a stable per-tenant job id so bursty ingest dedups to one seed", () => {
        const reactor = createRetentionOrphanSweepReactor({
          dispatchSweep: vi.fn(),
          retentionPolicyCache: {
            getRetentionDays: vi.fn().mockResolvedValue(30),
          } as any,
        });

        const id1 = reactor.options!.makeJobId!({
          event: { tenantId: "p1" },
        } as any);
        const id2 = reactor.options!.makeJobId!({
          event: { tenantId: "p1" },
        } as any);

        expect(id1).toBe(id2);
        expect(id1).toContain("p1");
      });
    });
  });

  describe("given retention is set to 0 (indefinite)", () => {
    describe("when the reactor handles an event", () => {
      it("does not seed the chain", async () => {
        const dispatchSweep = vi.fn().mockResolvedValue(undefined);
        const reactor = createRetentionOrphanSweepReactor({
          dispatchSweep,
          retentionPolicyCache: {
            getRetentionDays: vi.fn().mockResolvedValue(0),
          } as any,
        });

        await reactor.handle(
          { tenantId: "project-1" } as any,
          {
            tenantId: "project-1",
            aggregateId: "trace-1",
            foldState: {},
          } as any,
        );

        expect(dispatchSweep).not.toHaveBeenCalled();
      });
    });
  });

  describe("given retention is finite", () => {
    describe("when the reactor handles an event", () => {
      it("seeds the per-tenant orphan-sweep chain", async () => {
        const dispatchSweep = vi.fn().mockResolvedValue(undefined);
        const reactor = createRetentionOrphanSweepReactor({
          dispatchSweep,
          retentionPolicyCache: {
            getRetentionDays: vi.fn().mockResolvedValue(30),
          } as any,
        });

        await reactor.handle(
          { tenantId: "project-1" } as any,
          {
            tenantId: "project-1",
            aggregateId: "trace-1",
            foldState: {},
          } as any,
        );

        expect(dispatchSweep).toHaveBeenCalledWith({ tenantId: "project-1" });
      });
    });

    describe("when dispatchSweep throws", () => {
      it("logs the error and does not rethrow — next ingest retries", async () => {
        // Reactor failure must not propagate into the trace-processing
        // pipeline; the chain is a maintenance loop, not on the hot path.
        const dispatchSweep = vi
          .fn()
          .mockRejectedValue(new Error("redis unavailable"));
        const reactor = createRetentionOrphanSweepReactor({
          dispatchSweep,
          retentionPolicyCache: {
            getRetentionDays: vi.fn().mockResolvedValue(30),
          } as any,
        });

        await expect(
          reactor.handle(
            { tenantId: "project-1" } as any,
            {
              tenantId: "project-1",
              aggregateId: "trace-1",
              foldState: {},
            } as any,
          ),
        ).resolves.toBeUndefined();
      });
    });
  });
});
