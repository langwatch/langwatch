import { describe, expect, it, vi } from "vitest";
import {
  LangyConversationRepository,
  LangyConversationService,
} from "../LangyConversationService";

function makeRepo(overrides?: Partial<LangyConversationRepository>) {
  const repo = {
    findById: vi.fn(),
    findAllForUser: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    softDeleteAllForUser: vi.fn(),
    hardDeleteOlderThan: vi.fn(),
    touch: vi.fn(),
    ...overrides,
  } as unknown as LangyConversationRepository;
  return repo;
}

describe("LangyConversationService", () => {
  describe("given a conversation owned by another user in the same project", () => {
    describe("when getById is called by a non-owner without share", () => {
      it("returns null to prevent cross-user leakage", async () => {
        const repo = makeRepo({
          findById: vi.fn().mockResolvedValue({
            id: "c1",
            projectId: "p1",
            userId: "bob",
            isShared: false,
          }),
        });
        const svc = new LangyConversationService(repo);
        const result = await svc.getById({
          id: "c1",
          projectId: "p1",
          userId: "alice",
        });
        expect(result).toBeNull();
      });
    });

    describe("when the conversation is shared", () => {
      it("returns the conversation to non-owners in the same project", async () => {
        const conv = {
          id: "c1",
          projectId: "p1",
          userId: "bob",
          isShared: true,
        };
        const repo = makeRepo({
          findById: vi.fn().mockResolvedValue(conv),
        });
        const svc = new LangyConversationService(repo);
        const result = await svc.getById({
          id: "c1",
          projectId: "p1",
          userId: "alice",
        });
        expect(result).toEqual(conv);
      });
    });
  });

  describe("given a delete is requested by a non-owner", () => {
    it("does not delete and returns false", async () => {
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue({
          id: "c1",
          projectId: "p1",
          userId: "bob",
          isShared: true,
        }),
        softDelete: vi.fn().mockResolvedValue({ count: 1 }),
      });
      const svc = new LangyConversationService(repo);
      const result = await svc.deleteById({
        id: "c1",
        projectId: "p1",
        userId: "alice",
      });
      expect(result).toBe(false);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });
  });

  describe("when ensureConversation is called with no id", () => {
    it("creates a new conversation scoped to projectId and userId", async () => {
      const repo = makeRepo({
        create: vi
          .fn()
          .mockResolvedValue({ id: "new", projectId: "p1", userId: "alice" }),
      });
      const svc = new LangyConversationService(repo);
      await svc.ensureConversation({
        projectId: "p1",
        userId: "alice",
      });
      expect(repo.create).toHaveBeenCalledWith({
        projectId: "p1",
        userId: "alice",
        title: undefined,
      });
    });
  });

  describe("when clearAllForUser is called", () => {
    it("soft-deletes all the user's conversations and returns the count", async () => {
      const repo = makeRepo({
        softDeleteAllForUser: vi.fn().mockResolvedValue({ count: 7 }),
      });
      const svc = new LangyConversationService(repo);
      const result = await svc.clearAllForUser({
        projectId: "p1",
        userId: "alice",
      });
      expect(result.deletedCount).toBe(7);
    });
  });
});
