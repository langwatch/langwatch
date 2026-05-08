import { describe, expect, it, vi } from "vitest";
import {
  LangyProjectMemoryHistoryService,
  LangyProjectMemoryRepository,
  LangyProjectMemoryService,
} from "../LangyProjectMemoryService";

function makeService() {
  const repo = {
    findById: vi.fn(),
    upsert: vi.fn().mockResolvedValue({
      id: "m1",
      projectId: "p1",
      content: "x",
      contentVersion: 2,
      refreshedAt: new Date(),
    }),
    deleteByProjectId: vi.fn(),
  } as unknown as LangyProjectMemoryRepository;
  const history = {
    append: vi.fn(),
    getAll: vi.fn(),
  } as unknown as LangyProjectMemoryHistoryService;
  return {
    service: new LangyProjectMemoryService(repo, history),
    repo,
    history,
  };
}

describe("LangyProjectMemoryService", () => {
  describe("when writeNewVersion is called", () => {
    it("upserts the memory and appends a history row", async () => {
      const { service, history, repo } = makeService();
      await service.writeNewVersion({
        projectId: "p1",
        content: "hello",
        changeReason: "user_edit",
        changedById: "u1",
      });
      expect(repo.upsert).toHaveBeenCalledWith({
        projectId: "p1",
        content: "hello",
        contentSummary: undefined,
        lastEditorId: "u1",
      });
      expect(history.append).toHaveBeenCalledWith({
        projectMemoryId: "m1",
        projectId: "p1",
        contentVersion: 2,
        content: "hello",
        changedById: "u1",
        changeReason: "user_edit",
      });
    });
  });

  describe("given a memory refreshed 31 days ago", () => {
    describe("when isStale is checked", () => {
      it("returns true", async () => {
        const { service, repo } = makeService();
        (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
          refreshedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        });
        expect(await service.isStale({ projectId: "p1" })).toBe(true);
      });
    });
  });

  describe("given no memory exists", () => {
    it("isStale returns false", async () => {
      const { service, repo } = makeService();
      (repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      expect(await service.isStale({ projectId: "p1" })).toBe(false);
    });
  });
});
