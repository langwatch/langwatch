import { describe, expect, it, vi } from "vitest";
import {
  type LangyConversationCommands,
  type LangyConversationReadRepository,
  LangyConversationService,
} from "../langy-conversation.service";
import { LangyConversationNotOwnedError } from "../errors";

/** Latest-version fold row the read repository returns. */
type Row = {
  id: string;
  userId: string;
  title: string | null;
  isShared: boolean;
  status: string;
  messageCount: number;
  lastActivityAtMs: number;
  createdAtMs: number;
};

function makeRepo(overrides?: Partial<LangyConversationReadRepository>) {
  return {
    findById: vi.fn(),
    findAllForUser: vi.fn(),
    findActiveOwnedIds: vi.fn(),
    findPendingHandoff: vi.fn(async () => null),
    ...overrides,
  } as unknown as LangyConversationReadRepository;
}

function makeCommands(
  overrides?: Partial<LangyConversationCommands>,
): LangyConversationCommands {
  return {
    sendMessage: vi.fn(async () => {}),
    startAgentTurn: vi.fn(async () => {}),
    recordToolCallStarted: vi.fn(async () => {}),
    recordToolCallCompleted: vi.fn(async () => {}),
    recordAgentResponded: vi.fn(async () => {}),
    failAgentTurn: vi.fn(async () => {}),
    reconcileAgentTurn: vi.fn(async () => {}),
    archiveConversation: vi.fn(async () => {}),
    updateConversationMetadata: vi.fn(async () => {}),
    recordTurnHandoff: vi.fn(async () => {}),
    consumeTurnHandoff: vi.fn(async () => {}),
    generateConversationTitle: vi.fn(async () => {}),
    ...overrides,
  };
}

const row = (o: Partial<Row> = {}): Row => ({
  id: "c1",
  userId: "alice",
  title: null,
  isShared: false,
  status: "active",
  messageCount: 0,
  lastActivityAtMs: 0,
  createdAtMs: Date.parse("2026-04-01T00:00:00.000Z"),
  ...o,
});

describe("LangyConversationService", () => {
  describe("given a conversation owned by another user in the same project", () => {
    describe("when getById is called by a non-owner without share", () => {
      it("returns null to prevent cross-user leakage", async () => {
        const repo = makeRepo({
          findById: vi.fn().mockResolvedValue(row({ userId: "bob" })),
        });
        const svc = new LangyConversationService(repo, makeCommands());
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
        const repo = makeRepo({
          findById: vi
            .fn()
            .mockResolvedValue(row({ userId: "bob", isShared: true })),
        });
        const svc = new LangyConversationService(repo, makeCommands());
        const result = await svc.getById({
          id: "c1",
          projectId: "p1",
          userId: "alice",
        });
        expect(result).toMatchObject({ id: "c1", isOwn: false, isShared: true });
      });
    });
  });

  describe("given a delete is requested by a non-owner", () => {
    it("does not archive and returns false", async () => {
      const archiveConversation = vi.fn(async () => {});
      const repo = makeRepo({
        findById: vi
          .fn()
          .mockResolvedValue(row({ userId: "bob", isShared: true })),
      });
      const svc = new LangyConversationService(
        repo,
        makeCommands({ archiveConversation }),
      );
      const result = await svc.deleteById({
        id: "c1",
        projectId: "p1",
        userId: "alice",
      });
      expect(result).toBe(false);
      expect(archiveConversation).not.toHaveBeenCalled();
    });
  });

  describe("given a delete is requested by the owner", () => {
    it("dispatches an archive command and returns true", async () => {
      const archiveConversation = vi.fn(async () => {});
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(row({ userId: "alice" })),
      });
      const svc = new LangyConversationService(
        repo,
        makeCommands({ archiveConversation }),
      );
      const result = await svc.deleteById({
        id: "c1",
        projectId: "p1",
        userId: "alice",
      });
      expect(result).toBe(true);
      expect(archiveConversation).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "p1", conversationId: "c1" }),
      );
    });
  });

  describe("when ensureConversation is called with no id", () => {
    it("mints a fresh conversation id without writing", async () => {
      const repo = makeRepo();
      const svc = new LangyConversationService(repo, makeCommands());
      const result = await svc.ensureConversation({
        projectId: "p1",
        userId: "alice",
      });
      expect(result.id).toBeTruthy();
      expect(repo.findById).not.toHaveBeenCalled();
    });
  });

  describe("when ensureConversation is called with an id owned by the caller", () => {
    it("returns the same id", async () => {
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(row({ userId: "alice" })),
      });
      const svc = new LangyConversationService(repo, makeCommands());
      const result = await svc.ensureConversation({
        projectId: "p1",
        userId: "alice",
        conversationId: "c1",
      });
      expect(result.id).toBe("c1");
    });
  });

  describe("when ensureConversation is called with an id owned by another user", () => {
    it("throws LangyConversationNotOwnedError instead of forking a conversation", async () => {
      const repo = makeRepo({
        findById: vi
          .fn()
          .mockResolvedValue(row({ userId: "bob", isShared: true })),
      });
      const svc = new LangyConversationService(repo, makeCommands());
      await expect(
        svc.ensureConversation({
          projectId: "p1",
          userId: "alice",
          conversationId: "c1",
        }),
      ).rejects.toBeInstanceOf(LangyConversationNotOwnedError);
    });
  });

  describe("when ensureConversation is called with a stale (archived) id", () => {
    it("mints a fresh conversation id rather than throwing", async () => {
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(null),
      });
      const svc = new LangyConversationService(repo, makeCommands());
      const result = await svc.ensureConversation({
        projectId: "p1",
        userId: "alice",
        conversationId: "archived-id",
      });
      expect(result.id).not.toBe("archived-id");
      expect(result.id).toBeTruthy();
    });
  });

  describe("when getAll maps rows for the conversation list", () => {
    it("exposes lastActivityAt and messageCount and marks ownership", async () => {
      const lastActivityAtMs = Date.parse("2026-05-01T10:00:00.000Z");
      const repo = makeRepo({
        findAllForUser: vi
          .fn()
          .mockResolvedValue([
            row({ title: "t", lastActivityAtMs, messageCount: 3 }),
          ]),
      });
      const svc = new LangyConversationService(repo, makeCommands());
      const result = await svc.getAll({ projectId: "p1", userId: "alice" });
      expect(result[0]).toMatchObject({
        id: "c1",
        isOwn: true,
        lastActivityAt: new Date(lastActivityAtMs),
        messageCount: 3,
      });
      expect(result[0]).not.toHaveProperty("status");
    });

    it("falls back to createdAt when lastActivityAt is unset", async () => {
      const createdAtMs = Date.parse("2026-04-01T00:00:00.000Z");
      const repo = makeRepo({
        findAllForUser: vi
          .fn()
          .mockResolvedValue([row({ lastActivityAtMs: 0, createdAtMs })]),
      });
      const svc = new LangyConversationService(repo, makeCommands());
      const result = await svc.getAll({ projectId: "p1", userId: "alice" });
      expect(result[0]?.lastActivityAt).toEqual(new Date(createdAtMs));
    });
  });

  describe("when clearAllForUser is called", () => {
    it("archives each active owned conversation and returns the count", async () => {
      const archiveConversation = vi.fn(async () => {});
      const repo = makeRepo({
        findActiveOwnedIds: vi.fn().mockResolvedValue(["c1", "c2", "c3"]),
      });
      const svc = new LangyConversationService(
        repo,
        makeCommands({ archiveConversation }),
      );
      const result = await svc.clearAllForUser({
        projectId: "p1",
        userId: "alice",
      });
      expect(result.deletedCount).toBe(3);
      expect(archiveConversation).toHaveBeenCalledTimes(3);
    });
  });

  describe("when recordUserMessage is called", () => {
    it("dispatches one SendMessage command carrying the owner and parts", async () => {
      const sendMessage = vi.fn(async () => {});
      const svc = new LangyConversationService(
        makeRepo(),
        makeCommands({ sendMessage }),
      );
      await svc.recordUserMessage({
        projectId: "p1",
        conversationId: "c1",
        userId: "alice",
        parts: [{ type: "text", text: "hi" }],
        title: "hi",
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "p1",
          conversationId: "c1",
          userId: "alice",
          role: "user",
          title: "hi",
        }),
      );
    });
  });

  describe("given a turn checkpointed on shutdown (ADR-048 handoff)", () => {
    describe("when the handoff token is recorded", () => {
      it("dispatches recordTurnHandoff with the opaque token", async () => {
        const recordTurnHandoff = vi.fn(async () => {});
        const svc = new LangyConversationService(
          makeRepo(),
          makeCommands({ recordTurnHandoff }),
        );

        await svc.recordTurnHandoff({
          projectId: "p1",
          conversationId: "c1",
          turnId: "t1",
          token: "opaque-resume-token",
        });

        expect(recordTurnHandoff).toHaveBeenCalledTimes(1);
        expect(recordTurnHandoff).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: "p1",
            conversationId: "c1",
            turnId: "t1",
            token: "opaque-resume-token",
          }),
        );
      });
    });

    describe("when the next turn reads the pending handoff", () => {
      it("returns the token and turn threaded off the fold, then round-trips to consume", async () => {
        const findPendingHandoff = vi.fn(async () => ({
          token: "opaque-resume-token",
          turnId: "t1",
        }));
        const consumeTurnHandoff = vi.fn(async () => {});
        const svc = new LangyConversationService(
          makeRepo({ findPendingHandoff }),
          makeCommands({ consumeTurnHandoff }),
        );

        const pending = await svc.getPendingHandoff({
          projectId: "p1",
          conversationId: "c1",
        });
        expect(pending).toEqual({ token: "opaque-resume-token", turnId: "t1" });

        // Resume consumes the handoff, keyed on the handed-off turn.
        await svc.consumeHandoff({
          projectId: "p1",
          conversationId: "c1",
          turnId: pending!.turnId,
        });
        expect(consumeTurnHandoff).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: "p1",
            conversationId: "c1",
            turnId: "t1",
          }),
        );
      });
    });

    describe("when there is no pending handoff", () => {
      it("returns null so the next turn cold-starts", async () => {
        const svc = new LangyConversationService(makeRepo(), makeCommands());
        const pending = await svc.getPendingHandoff({
          projectId: "p1",
          conversationId: "c1",
        });
        expect(pending).toBeNull();
      });
    });
  });
});
