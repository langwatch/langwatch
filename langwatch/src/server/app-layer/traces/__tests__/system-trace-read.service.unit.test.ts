import { describe, expect, it, vi } from "vitest";
import type { Protections } from "~/server/traces/protections";
import { SystemTraceReadService } from "../system-trace-read.service";

const protections: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("SystemTraceReadService", () => {
  describe("when several traces of one project are read concurrently", () => {
    it("resolves the project's protections once", async () => {
      const gate = deferred<Protections>();
      const resolveProtections = vi.fn(() => gate.promise);
      const getById = vi.fn().mockResolvedValue(undefined);
      const service = new SystemTraceReadService({
        traces: { getById },
        resolveProtections,
      });

      const reads = Promise.all([
        service.getById({ projectId: "project-1", traceId: "trace-1" }),
        service.getById({ projectId: "project-1", traceId: "trace-2" }),
      ]);
      gate.resolve(protections);
      await reads;

      expect(resolveProtections).toHaveBeenCalledTimes(1);
      expect(getById).toHaveBeenNthCalledWith(
        1,
        "project-1",
        "trace-1",
        protections,
      );
      expect(getById).toHaveBeenNthCalledWith(
        2,
        "project-1",
        "trace-2",
        protections,
      );
    });

    it("keeps each project's protections separate", async () => {
      const resolveProtections = vi.fn().mockResolvedValue(protections);
      const service = new SystemTraceReadService({
        traces: { getById: vi.fn().mockResolvedValue(undefined) },
        resolveProtections,
      });

      await Promise.all([
        service.getById({ projectId: "project-1", traceId: "trace-1" }),
        service.getById({ projectId: "project-2", traceId: "trace-2" }),
      ]);

      expect(resolveProtections).toHaveBeenCalledTimes(2);
      expect(resolveProtections).toHaveBeenCalledWith("project-1");
      expect(resolveProtections).toHaveBeenCalledWith("project-2");
    });
  });

  describe("when a read starts after the previous lookup settled", () => {
    it("resolves protections again rather than serving a cached policy", async () => {
      const resolveProtections = vi.fn().mockResolvedValue(protections);
      const service = new SystemTraceReadService({
        traces: { getById: vi.fn().mockResolvedValue(undefined) },
        resolveProtections,
      });

      await service.getById({ projectId: "project-1", traceId: "trace-1" });
      await service.getById({ projectId: "project-1", traceId: "trace-2" });

      expect(resolveProtections).toHaveBeenCalledTimes(2);
    });
  });

  describe("when resolving protections fails", () => {
    it("rejects the read and drops the failed lookup", async () => {
      const resolveProtections = vi
        .fn()
        .mockRejectedValueOnce(new Error("policy service down"))
        .mockResolvedValueOnce(protections);
      const getById = vi.fn().mockResolvedValue(undefined);
      const service = new SystemTraceReadService({
        traces: { getById },
        resolveProtections,
      });

      await expect(
        service.getById({ projectId: "project-1", traceId: "trace-1" }),
      ).rejects.toThrow("policy service down");
      expect(getById).not.toHaveBeenCalled();

      await service.getById({ projectId: "project-1", traceId: "trace-2" });
      expect(getById).toHaveBeenCalledWith("project-1", "trace-2", protections);
    });
  });
});
