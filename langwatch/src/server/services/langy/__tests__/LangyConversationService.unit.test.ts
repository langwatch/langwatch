import type { LangyConversation } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  LangyConversationNotOwnedError,
  type LangyConversationRepository,
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
    bumpActivity: vi.fn(),
    ...overrides,
  } as unknown as LangyConversationRepository;
  return repo;
}

// Base fixture typed against the real Prisma model so TypeScript catches
// shape drift when the schema changes. Tests override only the fields they care about.
const baseConversation = {
  id: "c1",
  projectId: "p1",
  userId: "alice",
  title: null,
  isShared: false,
  sharedAt: null,
  sharedById: null,
  lastActivityAt: null,
  messageCount: 0,
  createdAt: new Date("2026-04-01T00:00:00.000Z"),
  updatedAt: new Date("2026-04-01T00:00:00.000Z"),
  deletedAt: null,
} satisfies LangyConversation;

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

  describe("when ensureConversation is called with an id owned by the caller", () => {
    it("returns the existing conversation without creating a new one", async () => {
      const existing = {
        id: "c1",
        projectId: "p1",
        userId: "alice",
        isShared: false,
      };
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(existing),
        create: vi.fn(),
      });
      const svc = new LangyConversationService(repo);
      const result = await svc.ensureConversation({
        projectId: "p1",
        userId: "alice",
        conversationId: "c1",
      });
      expect(result).toEqual(existing);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe("when ensureConversation is called with an id owned by another user", () => {
    it("throws LangyConversationNotOwnedError instead of silently forking a new conversation", async () => {
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue({
          id: "c1",
          projectId: "p1",
          userId: "bob",
          isShared: true,
        }),
        create: vi.fn(),
      });
      const svc = new LangyConversationService(repo);
      await expect(
        svc.ensureConversation({
          projectId: "p1",
          userId: "alice",
          conversationId: "c1",
        }),
      ).rejects.toBeInstanceOf(LangyConversationNotOwnedError);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe("when ensureConversation is called with a stale (deleted) id", () => {
    it("creates a fresh conversation rather than throwing", async () => {
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(null),
        create: vi
          .fn()
          .mockResolvedValue({ id: "new", projectId: "p1", userId: "alice" }),
      });
      const svc = new LangyConversationService(repo);
      const result = await svc.ensureConversation({
        projectId: "p1",
        userId: "alice",
        conversationId: "deleted-id",
      });
      expect(result.id).toBe("new");
      expect(repo.create).toHaveBeenCalled();
    });
  });

  describe("when getAll maps rows for the conversation list", () => {
    it("exposes the row's lastActivityAt and messageCount for the UI list", async () => {
      const lastActivityAt = new Date("2026-05-01T10:00:00.000Z");
      const repo = makeRepo({
        findAllForUser: vi.fn().mockResolvedValue([
          {
            ...baseConversation,
            title: "t",
            lastActivityAt,
            messageCount: 3,
          },
        ]),
      });
      const svc = new LangyConversationService(repo);
      const result = await svc.getAll({ projectId: "p1", userId: "alice" });
      expect(result[0]).toMatchObject({
        id: "c1",
        isOwn: true,
        lastActivityAt,
        messageCount: 3,
      });
      expect(result[0]).not.toHaveProperty("updatedAt");
    });

    it("falls back to createdAt when lastActivityAt is null (row created before first message)", async () => {
      const createdAt = new Date("2026-04-01T00:00:00.000Z");
      const repo = makeRepo({
        findAllForUser: vi
          .fn()
          .mockResolvedValue([
            { ...baseConversation, id: "c2", lastActivityAt: null, createdAt },
          ]),
      });
      const svc = new LangyConversationService(repo);
      const result = await svc.getAll({ projectId: "p1", userId: "alice" });
      expect(result[0]?.lastActivityAt).toEqual(createdAt);
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
