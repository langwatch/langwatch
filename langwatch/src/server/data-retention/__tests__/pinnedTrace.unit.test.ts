import { describe, expect, it } from "vitest";
import { createInMemoryPinnedTraceService } from "../pinning/inMemoryPinnedTraceService";
import { PinnedToActiveShareError } from "../pinning/pinnedTrace.service";

const project = "project-1";
const trace = "abc123";

describe("PinnedTraceService", () => {
  describe("given an unpinned trace", () => {
    describe("when pin() is called", () => {
      /** @scenario Pinning a trace does not change retention */
      it("records a manual pin visible to reads", async () => {
        const service = createInMemoryPinnedTraceService();

        const pin = await service.pin({
          projectId: project,
          traceId: trace,
          userId: "user-1",
        });

        expect(pin.projectId).toBe(project);
        expect(pin.traceId).toBe(trace);
        expect(pin.source).toBe("manual");
        expect(pin.userId).toBe("user-1");
        await expect(
          service.isPinned({ projectId: project, traceId: trace }),
        ).resolves.toBe(true);
      });
    });

    describe("when autoPin() is called", () => {
      it("records a share pin visible to reads", async () => {
        const service = createInMemoryPinnedTraceService();

        const pin = await service.autoPin({ projectId: project, traceId: trace });

        expect(pin.source).toBe("share");
        const read = await service.getPin({ projectId: project, traceId: trace });
        expect(read?.source).toBe("share");
      });
    });
  });

  describe("given a pinned trace", () => {
    describe("when unpin() is called", () => {
      it("clears the pin", async () => {
        const service = createInMemoryPinnedTraceService();

        await service.pin({ projectId: project, traceId: trace });
        await service.unpin({ projectId: project, traceId: trace });

        await expect(
          service.isPinned({ projectId: project, traceId: trace }),
        ).resolves.toBe(false);
      });
    });

    describe("when the trace is unpinned then pinned again", () => {
      /**
       * Regression: the pin/unpin events are deduped by idempotencyKey on the
       * fold read. A stable key would collapse the re-pin against the first pin
       * and leave the trace wrongly unpinned. The command keys off occurredAt to
       * keep each toggle distinct — this asserts the toggle round-trips.
       */
      it("ends up pinned", async () => {
        const service = createInMemoryPinnedTraceService();

        await service.pin({ projectId: project, traceId: trace });
        await service.unpin({ projectId: project, traceId: trace });
        await service.pin({ projectId: project, traceId: trace });

        await expect(
          service.isPinned({ projectId: project, traceId: trace }),
        ).resolves.toBe(true);
      });
    });
  });

  describe("given a source=share pin whose share is still active", () => {
    describe("when unpin() is called manually", () => {
      it("throws PinnedToActiveShareError and leaves the pin intact", async () => {
        const service = createInMemoryPinnedTraceService(async () => true);

        await service.autoPin({ projectId: project, traceId: trace });

        await expect(
          service.unpin({ projectId: project, traceId: trace }),
        ).rejects.toBeInstanceOf(PinnedToActiveShareError);

        await expect(
          service.isPinned({ projectId: project, traceId: trace }),
        ).resolves.toBe(true);
      });
    });
  });

  describe("given a share→manual promotion whose share is still active", () => {
    describe("when unpin() is called manually", () => {
      it("throws PinnedToActiveShareError — the guard ignores pin source", async () => {
        const service = createInMemoryPinnedTraceService(async () => true);

        await service.autoPin({ projectId: project, traceId: trace });
        await service.pin({
          projectId: project,
          traceId: trace,
          reason: "regression investigation",
        });

        await expect(
          service.unpin({ projectId: project, traceId: trace }),
        ).rejects.toBeInstanceOf(PinnedToActiveShareError);

        await expect(
          service.isPinned({ projectId: project, traceId: trace }),
        ).resolves.toBe(true);
      });
    });
  });

  describe("given a source=share pin whose share has already been removed", () => {
    describe("when unpin() is called manually", () => {
      it("allows the unpin — there's no longer a share to protect", async () => {
        const service = createInMemoryPinnedTraceService(async () => false);

        await service.autoPin({ projectId: project, traceId: trace });
        await service.unpin({ projectId: project, traceId: trace });

        await expect(
          service.isPinned({ projectId: project, traceId: trace }),
        ).resolves.toBe(false);
      });
    });
  });

  describe("given an auto-share pin promoted to manual", () => {
    describe("when autoUnpin() runs after share is removed", () => {
      /** @scenario Manual pin survives unsharing an auto-shared trace */
      it("keeps the trace pinned", async () => {
        const service = createInMemoryPinnedTraceService();

        await service.autoPin({ projectId: project, traceId: trace });
        await service.pin({
          projectId: project,
          traceId: trace,
          reason: "regression investigation",
        });
        await service.autoUnpin({ projectId: project, traceId: trace });

        const read = await service.getPin({ projectId: project, traceId: trace });
        expect(read?.source).toBe("manual");
      });
    });
  });

  describe("listByProject", () => {
    it("returns only the pinned traces of the project", async () => {
      const service = createInMemoryPinnedTraceService();

      await service.pin({ projectId: project, traceId: "t1" });
      await service.autoPin({ projectId: project, traceId: "t2" });
      await service.pin({ projectId: "other-project", traceId: "t3" });

      const pins = await service.listByProject({ projectId: project });
      expect(pins.map((p) => p.traceId).sort()).toEqual(["t1", "t2"]);

      const ids = await service.getPinnedTraceIds({ projectId: project });
      expect(ids.sort()).toEqual(["t1", "t2"]);
    });
  });
});
