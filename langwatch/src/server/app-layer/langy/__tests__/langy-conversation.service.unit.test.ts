import { describe, expect, it, vi } from "vitest";
import {
  LangyConversationNotFoundError,
  LangyConversationNotOwnedError,
} from "../errors";
import {
  type LangyConversationCommands,
  type LangyConversationReadRepository,
  LangyConversationService,
} from "../langy-conversation.service";

/** Latest-version fold row the read repository returns. */
type Row = {
  id: string;
  userId: string;
  title: string | null;
  isShared: boolean;
  status: string;
  lastError: string | null;
  messageCount: number;
  lastActivityAtMs: number;
  cursorActivityAtMs?: number | null;
  createdAtMs: number;
};

function makeRepo(
  overrides: Partial<LangyConversationReadRepository> = {},
): LangyConversationReadRepository {
  const defaults: LangyConversationReadRepository = {
    findVisibleById: vi.fn(async () => null),
    findOwnership: vi.fn(async () => "missing" as const),
    findAllForUser: vi.fn(async () => []),
    findActiveOwnedIds: vi.fn(async () => []),
    findPendingHandoff: vi.fn(async () => null),
    findRunToken: vi.fn(async () => null),
    turnExists: vi.fn(async () => false),
  };
  return { ...defaults, ...overrides };
}

function makeCommands(
  overrides?: Partial<LangyConversationCommands>,
): LangyConversationCommands {
  return {
    createConversation: vi.fn(async () => {}),
    forkConversation: vi.fn(async () => {}),
    recordMessage: vi.fn(async () => {}),
    importMessage: vi.fn(async () => {}),
    acceptAgentTurn: vi.fn(async () => {}),
    initiateToolCall: vi.fn(async () => {}),
    succeedToolCall: vi.fn(async () => {}),
    failToolCall: vi.fn(async () => {}),
    updatePlan: vi.fn(async () => {}),
    failAgentResponse: vi.fn(async () => {}),
    recordAgentResponse: vi.fn(async () => {}),
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
  lastError: null,
  messageCount: 0,
  lastActivityAtMs: 0,
  createdAtMs: Date.parse("2026-04-01T00:00:00.000Z"),
  ...o,
});

describe("LangyConversationService", () => {
  describe("given a conversation owned by another user in the same project", () => {
    describe("when getById is called by a non-owner without share", () => {
      it("throws not-found — reported as not-found so it can't probe existence", async () => {
        // Cross-user leakage prevention: a conversation you may not see must be
        // indistinguishable from one that does not exist, or the error becomes an
        // existence oracle across users.
        const repo = makeRepo({
          findVisibleById: vi.fn().mockResolvedValue(null),
        });
        const svc = new LangyConversationService(repo, makeCommands());
        await expect(
          svc.getById({ id: "c1", projectId: "p1", userId: "alice" }),
        ).rejects.toThrow(LangyConversationNotFoundError);
      });

      it("findByIdVisible returns null for the same case", async () => {
        const repo = makeRepo({
          findVisibleById: vi.fn().mockResolvedValue(null),
        });
        const svc = new LangyConversationService(repo, makeCommands());
        expect(
          await svc.findByIdVisible({
            id: "c1",
            projectId: "p1",
            userId: "alice",
          }),
        ).toBeNull();
      });
    });

    describe("when the conversation does not exist (or its fold is not projected yet)", () => {
      it("getById throws rather than returning an ambiguous null", async () => {
        // The bug this shape exists to kill: `null` used to mean BOTH "no such
        // conversation" and "exists but not projected yet", and the stream routes
        // 404'd on the second because it looked like the first.
        const repo = makeRepo({
          findVisibleById: vi.fn().mockResolvedValue(null),
        });
        const svc = new LangyConversationService(repo, makeCommands());
        await expect(
          svc.getById({ id: "c1", projectId: "p1", userId: "alice" }),
        ).rejects.toThrow(LangyConversationNotFoundError);
      });
    });

    describe("when the conversation is shared", () => {
      it("returns the conversation to non-owners in the same project", async () => {
        const repo = makeRepo({
          findVisibleById: vi
            .fn()
            .mockResolvedValue(row({ userId: "bob", isShared: true })),
        });
        const svc = new LangyConversationService(repo, makeCommands());
        const result = await svc.getById({
          id: "c1",
          projectId: "p1",
          userId: "alice",
        });
        expect(result).toMatchObject({
          id: "c1",
          isOwn: false,
          isShared: true,
        });
      });
    });
  });

  describe("given a delete is requested by a non-owner", () => {
    it("does not archive and returns false", async () => {
      const archiveConversation = vi.fn(async () => {});
      const repo = makeRepo({
        findVisibleById: vi
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
        findVisibleById: vi.fn().mockResolvedValue(row({ userId: "alice" })),
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
      expect(repo.findOwnership).not.toHaveBeenCalled();
    });
  });

  describe("when ensureConversation is called with an id owned by the caller", () => {
    it("returns the same id", async () => {
      const repo = makeRepo({
        findOwnership: vi.fn().mockResolvedValue("owned"),
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
        findOwnership: vi.fn().mockResolvedValue("other"),
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
        findOwnership: vi.fn().mockResolvedValue("missing"),
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

  describe("when getPage reads recent conversations", () => {
    it("passes trimmed search and cursor through the tenant-scoped repository", async () => {
      const cursor = { lastActivityAtMs: 200, id: "c2" };
      const findAllForUser = vi
        .fn()
        .mockResolvedValue([
          row({ id: "c3", lastActivityAtMs: 190 }),
          row({ id: "c2", lastActivityAtMs: 180 }),
          row({ id: "c1", lastActivityAtMs: 170 }),
        ]);
      const svc = new LangyConversationService(
        makeRepo({ findAllForUser }),
        makeCommands(),
      );

      const result = await svc.getPage({
        projectId: "p1",
        userId: "alice",
        limit: 2,
        cursor,
        query: "  latency  ",
      });

      expect(findAllForUser).toHaveBeenCalledWith({
        projectId: "p1",
        userId: "alice",
        limit: 3,
        cursor,
        query: "latency",
      });
      expect(result.items.map((item) => item.id)).toEqual(["c3", "c2"]);
      expect(result.nextCursor).toEqual({
        lastActivityAtMs: 180,
        id: "c2",
      });
    });

    it("preserves a null activity cursor and omits nextCursor on the last page", async () => {
      const svcWithMore = new LangyConversationService(
        makeRepo({
          findAllForUser: vi.fn().mockResolvedValue([
            row({
              id: "c2",
              lastActivityAtMs: 0,
              cursorActivityAtMs: null,
            }),
            row({ id: "c1" }),
          ]),
        }),
        makeCommands(),
      );
      await expect(
        svcWithMore.getPage({ projectId: "p1", userId: "alice", limit: 1 }),
      ).resolves.toMatchObject({
        nextCursor: { lastActivityAtMs: null, id: "c2" },
      });

      const svcAtEnd = new LangyConversationService(
        makeRepo({
          findAllForUser: vi.fn().mockResolvedValue([row({ id: "only" })]),
        }),
        makeCommands(),
      );
      await expect(
        svcAtEnd.getPage({ projectId: "p1", userId: "alice", limit: 2 }),
      ).resolves.toMatchObject({ nextCursor: null });
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
    it("dispatches one RecordMessage command carrying the owner and parts", async () => {
      const recordMessage = vi.fn(async () => {});
      const svc = new LangyConversationService(
        makeRepo(),
        makeCommands({ recordMessage }),
      );
      await svc.recordUserMessage({
        projectId: "p1",
        conversationId: "c1",
        userId: "alice",
        parts: [{ type: "text", text: "hi" }],
        title: "hi",
      });
      expect(recordMessage).toHaveBeenCalledTimes(1);
      expect(recordMessage).toHaveBeenCalledWith(
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

  describe("ingestAgentTurnResult (the durable HTTP-final path)", () => {
    describe("when the agent posts a completed turn", () => {
      it("dispatches recordAgentResponse carrying the turnId and assembled parts", async () => {
        const recordAgentResponse = vi.fn<
          LangyConversationCommands["recordAgentResponse"]
        >(async () => {});
        const svc = new LangyConversationService(
          makeRepo(),
          makeCommands({ recordAgentResponse }),
        );

        await svc.ingestAgentTurnResult({
          projectId: "p1",
          conversationId: "c1",
          turnId: "turn-9",
          status: "completed",
          text: "the answer",
          toolCalls: [{ id: "t1", name: "search", output: "hit" }],
        });

        expect(recordAgentResponse).toHaveBeenCalledTimes(1);
        const arg = recordAgentResponse.mock.calls[0]![0];
        // turnId rides the command — its event's idempotencyKey is derived from
        // it, so a duplicate (relay already finalized, or a retried POST) dedupes.
        expect(arg).toMatchObject({
          tenantId: "p1",
          conversationId: "c1",
          turnId: "turn-9",
          outcome: "completed",
        });
        // Tool card before prose.
        expect(arg.parts).toEqual([
          {
            type: "tool-search",
            toolCallId: "t1",
            state: "output-available",
            output: "hit",
          },
          { type: "text", text: "the answer", role: "assistant" },
        ]);
      });
    });

    describe("when the agent posts a failed turn", () => {
      it("dispatches failAgentResponse with a serialized domain error, never raw prose", async () => {
        const failAgentResponse = vi.fn<
          LangyConversationCommands["failAgentResponse"]
        >(async () => {});
        const svc = new LangyConversationService(
          makeRepo(),
          makeCommands({ failAgentResponse }),
        );

        await svc.ingestAgentTurnResult({
          projectId: "p1",
          conversationId: "c1",
          turnId: "turn-9",
          status: "failed",
          errorCode: "session-not-found",
        });

        expect(failAgentResponse).toHaveBeenCalledTimes(1);
        const arg = failAgentResponse.mock.calls[0]![0];
        expect(arg.turnId).toBe("turn-9");
        // The stored error is a serialized SerializedHandledError (has a `kind`),
        // not the raw code — LastError is rendered on history load.
        const parsed = JSON.parse(arg.error) as { kind?: string };
        expect(parsed.kind).toBe("langy_agent_session_lost");
      });
    });
  });
});
