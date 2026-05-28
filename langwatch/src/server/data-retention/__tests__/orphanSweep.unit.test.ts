import { describe, expect, it, vi } from "vitest";
import { OrphanSweepService } from "../orphan-sweep/orphanSweep.service";
import { createRetentionOrphanSweepReactor } from "../orphan-sweep/retentionOrphanSweep.reactor";

describe("OrphanSweepService", () => {
  describe("sweepProject()", () => {
    /** @scenario Proactive orphan sweep removes discovered orphan records */
    it("discovers candidate trace ids and cleans those missing from ClickHouse", async () => {
      const repository = {
        findCandidateTraceIds: vi.fn().mockResolvedValue(["missing", "live"]),
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
        findCandidateTraceIds: vi.fn().mockResolvedValue(["missing"]),
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
  });
});

describe("createRetentionOrphanSweepReactor()", () => {
  describe("given the reactor is configured", () => {
    describe("when the reactor's options are inspected", () => {
      it("returns a stable per-tenant job id so the queue dedups concurrent sweeps", () => {
        const reactor = createRetentionOrphanSweepReactor({
          orphanSweep: { sweepProject: vi.fn() } as any,
          retentionPolicyCache: {
            getRetentionDays: vi.fn().mockResolvedValue(30),
          } as any,
        });

        const id1 = reactor.options!.makeJobId!({ event: { tenantId: "p1" } } as any);
        const id2 = reactor.options!.makeJobId!({ event: { tenantId: "p1" } } as any);

        expect(id1).toBe(id2);
        expect(id1).toContain("p1");
      });
    });
  });

  describe("given retention is set to 0 (indefinite)", () => {
    describe("when the reactor handles an event", () => {
      it("skips sweeping for the tenant", async () => {
        const sweepProject = vi.fn().mockResolvedValue(undefined);
        const reactor = createRetentionOrphanSweepReactor({
          orphanSweep: { sweepProject } as any,
          retentionPolicyCache: {
            getRetentionDays: vi.fn().mockResolvedValue(0),
          } as any,
        });

        await reactor.handle(
          { tenantId: "project-1" } as any,
          { tenantId: "project-1", aggregateId: "trace-1", foldState: {} } as any,
        );

        expect(sweepProject).not.toHaveBeenCalled();
      });
    });
  });

  describe("given retention is finite", () => {
    describe("when the reactor handles an event", () => {
      it("invokes orphanSweep.sweepProject for the tenant", async () => {
        const sweepProject = vi.fn().mockResolvedValue(undefined);
        const reactor = createRetentionOrphanSweepReactor({
          orphanSweep: { sweepProject } as any,
          retentionPolicyCache: {
            getRetentionDays: vi.fn().mockResolvedValue(30),
          } as any,
        });

        await reactor.handle(
          { tenantId: "project-1" } as any,
          { tenantId: "project-1", aggregateId: "trace-1", foldState: {} } as any,
        );

        expect(sweepProject).toHaveBeenCalledWith({ projectId: "project-1" });
      });
    });

    describe("when sweepProject throws", () => {
      it("logs the error and does not rethrow", async () => {
        const sweepProject = vi
          .fn()
          .mockRejectedValue(new Error("temporary failure"));
        const reactor = createRetentionOrphanSweepReactor({
          orphanSweep: { sweepProject } as any,
          retentionPolicyCache: {
            getRetentionDays: vi.fn().mockResolvedValue(30),
          } as any,
        });

        await expect(
          reactor.handle(
            { tenantId: "project-1" } as any,
            { tenantId: "project-1", aggregateId: "trace-1", foldState: {} } as any,
          ),
        ).resolves.toBeUndefined();
      });
    });
  });
});
