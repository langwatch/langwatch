import type { PrismaClient } from "@prisma/client";
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
  // $transaction is the only PrismaClient method the service uses directly;
  // forward the callback's tx into the repo/history mocks so we can assert
  // both writes happen inside the same atomic block.
  const $transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb({ TX_MARKER: true }));
  const prisma = { $transaction } as unknown as PrismaClient;
  return {
    service: new LangyProjectMemoryService(repo, history, prisma),
    repo,
    history,
    $transaction,
  };
}

describe("LangyProjectMemoryService", () => {
  describe("when writeNewVersion is called", () => {
    it("upserts the memory and appends a history row inside one transaction", async () => {
      const { service, history, repo, $transaction } = makeService();
      await service.writeNewVersion({
        projectId: "p1",
        content: "hello",
        changeReason: "user_edit",
        changedById: "u1",
      });
      expect($transaction).toHaveBeenCalledTimes(1);
      expect(repo.upsert).toHaveBeenCalledWith(
        {
          projectId: "p1",
          content: "hello",
          contentSummary: undefined,
          lastEditorId: "u1",
        },
        { TX_MARKER: true },
      );
      expect(history.append).toHaveBeenCalledWith(
        {
          projectMemoryId: "m1",
          projectId: "p1",
          contentVersion: 2,
          content: "hello",
          changedById: "u1",
          changeReason: "user_edit",
        },
        { TX_MARKER: true },
      );
    });

    it("does not append history when the upsert fails inside the transaction", async () => {
      const { service, history, repo } = makeService();
      (repo.upsert as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("db down"),
      );
      await expect(
        service.writeNewVersion({
          projectId: "p1",
          content: "hello",
          changeReason: "user_edit",
          changedById: "u1",
        }),
      ).rejects.toThrow("db down");
      expect(history.append).not.toHaveBeenCalled();
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
