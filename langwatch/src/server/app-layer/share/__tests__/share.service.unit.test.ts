import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PinnedTraceService } from "~/server/data-retention/pinning/pinnedTrace.service";
import type { ShareRepository } from "../repositories/share.repository";
import { ShareService } from "../share.service";

describe("ShareService.revokeAllTraceShares", () => {
  let repo: ShareRepository;
  let pinnedTraces: Pick<PinnedTraceService, "autoUnpin" | "autoPin">;
  let service: ShareService;

  beforeEach(() => {
    repo = {
      findById: vi.fn(),
      findByResource: vi.fn(),
      findByResourceType: vi.fn(),
      create: vi.fn(),
      deleteByResource: vi.fn(),
      findAllTraceShareResourceIds: vi.fn(),
      deleteAllTraceShares: vi.fn(),
    } as ShareRepository;
    pinnedTraces = {
      autoUnpin: vi.fn().mockResolvedValue(undefined),
      autoPin: vi.fn().mockResolvedValue(undefined),
    };
    service = new ShareService(repo, pinnedTraces as PinnedTraceService);
  });

  describe("regression: source=share pins must be cleared when bulk-revoking", () => {
    /**
     * Disabling trace sharing via project settings calls `revokeAllTraceShares`
     * which previously did a single bulk DELETE. The single-trace `unshare()`
     * runs `autoUnpin` first, so `source=share` pins disappeared with their
     * share — bulk did not, leaving orphaned share-sourced pins behind.
     */
    it("auto-unpins every trace share before deleting them", async () => {
      vi.mocked(repo.findAllTraceShareResourceIds).mockResolvedValue([
        "trace_a",
        "trace_b",
        "trace_c",
      ]);

      await service.revokeAllTraceShares("project_1");

      expect(pinnedTraces.autoUnpin).toHaveBeenCalledTimes(3);
      expect(pinnedTraces.autoUnpin).toHaveBeenCalledWith({
        projectId: "project_1",
        traceId: "trace_a",
      });
      expect(pinnedTraces.autoUnpin).toHaveBeenCalledWith({
        projectId: "project_1",
        traceId: "trace_b",
      });
      expect(pinnedTraces.autoUnpin).toHaveBeenCalledWith({
        projectId: "project_1",
        traceId: "trace_c",
      });
      expect(repo.deleteAllTraceShares).toHaveBeenCalledWith("project_1");
    });

    it("continues with the remaining traces when one auto-unpin fails", async () => {
      vi.mocked(repo.findAllTraceShareResourceIds).mockResolvedValue([
        "trace_a",
        "trace_b",
      ]);
      vi.mocked(pinnedTraces.autoUnpin)
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce(undefined);

      await service.revokeAllTraceShares("project_1");

      expect(pinnedTraces.autoUnpin).toHaveBeenCalledTimes(2);
      // Bulk delete still runs — one stuck pin must not block the revocation.
      expect(repo.deleteAllTraceShares).toHaveBeenCalledWith("project_1");
    });
  });

  describe("when there are no trace shares", () => {
    it("still calls the bulk delete (idempotent) without invoking autoUnpin", async () => {
      vi.mocked(repo.findAllTraceShareResourceIds).mockResolvedValue([]);

      await service.revokeAllTraceShares("project_1");

      expect(pinnedTraces.autoUnpin).not.toHaveBeenCalled();
      expect(repo.deleteAllTraceShares).toHaveBeenCalledWith("project_1");
    });
  });
});
