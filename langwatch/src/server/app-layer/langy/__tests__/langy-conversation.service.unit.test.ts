import { describe, expect, it, vi } from "vitest";
import { REHYDRATION_WINDOW_MS } from "~/server/event-sourcing/stores/rehydrationWindow";
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
  currentTurnId: string | null;
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
  currentTurnId: null,
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

  describe("getEventsAfter — the tail the browser folds (ADR-059)", () => {
    // Fixtures only need to satisfy the reader port structurally.
    const makeEvents = (events: unknown[]) => ({
      getEventsOccurredSince: vi.fn(async () => events as never),
    });

    const visibleRepo = () =>
      makeRepo({
        findVisibleById: vi.fn().mockResolvedValue(row()),
      });

    const plainTurnEvent = (o: {
      id: string;
      createdAt: number;
      type?: string;
      data?: Record<string, unknown>;
    }) => ({
      id: o.id,
      aggregateId: "c1",
      aggregateType: "langy_conversation",
      tenantId: "p1",
      createdAt: o.createdAt,
      occurredAt: o.createdAt - 10,
      type: o.type ?? "lw.langy_conversation.tool_call_initiated",
      version: "2026-07-10",
      data: o.data ?? {
        conversationId: "c1",
        turnId: "t1",
        toolCallId: `tc-${o.id}`,
        toolName: "bash",
      },
    });

    describe("when the conversation is not visible to the caller", () => {
      it("throws not-found and never touches the event log", async () => {
        const events = makeEvents([]);
        const svc = new LangyConversationService(
          makeRepo(),
          makeCommands(),
          undefined,
          events,
        );
        await expect(
          svc.getEventsAfter({
            projectId: "p1",
            conversationId: "c1",
            userId: "alice",
            after: { acceptedAt: 0, eventId: "" },
          }),
        ).rejects.toThrow(LangyConversationNotFoundError);
        expect(events.getEventsOccurredSince).not.toHaveBeenCalled();
      });
    });

    describe("when no event reader is configured", () => {
      it("answers with an honest empty tail at the caller's own cursor", async () => {
        const svc = new LangyConversationService(visibleRepo(), makeCommands());
        const after = { acceptedAt: 5, eventId: "e5" };
        expect(
          await svc.getEventsAfter({
            projectId: "p1",
            conversationId: "c1",
            userId: "alice",
            after,
          }),
        ).toEqual({ events: [], cursor: after, truncated: false });
      });
    });

    describe("given a stream with events before and after the cursor", () => {
      it("returns only the strict tail, advances the cursor to its last event", async () => {
        const svc = new LangyConversationService(
          visibleRepo(),
          makeCommands(),
          undefined,
          makeEvents([
            plainTurnEvent({ id: "e1", createdAt: 100 }),
            plainTurnEvent({ id: "e2", createdAt: 200 }),
            plainTurnEvent({ id: "e3", createdAt: 300 }),
          ]),
        );
        const result = await svc.getEventsAfter({
          projectId: "p1",
          conversationId: "c1",
          userId: "alice",
          after: { acceptedAt: 200, eventId: "e2" },
        });
        expect(result.events.map((e) => e.id)).toEqual(["e3"]);
        expect(result.cursor).toEqual({ acceptedAt: 300, eventId: "e3" });
        expect(result.truncated).toBe(false);
      });

      it("floors the storage read a rehydration window below the cursor, never negative", async () => {
        // The bound is on OCCURRED time while the cursor is on ACCEPT time,
        // so it must sit a full safety window below the cursor — pruning old
        // partitions without ever excluding a delayed event's occurred-at.
        const events = makeEvents([]);
        const svc = new LangyConversationService(
          visibleRepo(),
          makeCommands(),
          undefined,
          events,
        );
        const acceptedAt = REHYDRATION_WINDOW_MS + 5_000;
        await svc.getEventsAfter({
          projectId: "p1",
          conversationId: "c1",
          userId: "alice",
          after: { acceptedAt, eventId: "e1" },
        });
        expect(events.getEventsOccurredSince).toHaveBeenCalledWith(
          "c1",
          expect.anything(),
          "langy_conversation",
          5_000,
        );

        await svc.getEventsAfter({
          projectId: "p1",
          conversationId: "c1",
          userId: "alice",
          after: { acceptedAt: 10, eventId: "e1" },
        });
        expect(events.getEventsOccurredSince).toHaveBeenLastCalledWith(
          "c1",
          expect.anything(),
          "langy_conversation",
          0,
        );
      });

      it("tie-breaks same-millisecond events by event id, byte-wise", async () => {
        const svc = new LangyConversationService(
          visibleRepo(),
          makeCommands(),
          undefined,
          makeEvents([
            plainTurnEvent({ id: "2AAa", createdAt: 100 }),
            plainTurnEvent({ id: "2AAb", createdAt: 100 }),
          ]),
        );
        const result = await svc.getEventsAfter({
          projectId: "p1",
          conversationId: "c1",
          userId: "alice",
          after: { acceptedAt: 100, eventId: "2AAa" },
        });
        expect(result.events.map((e) => e.id)).toEqual(["2AAb"]);
      });
    });

    describe("given spine events mixed into the stream", () => {
      it("serves ONLY the turn vocabulary — a runToken can never ride the tail", async () => {
        // The security pin: conversation_started carries the server-only
        // runToken. It must be excluded by TYPE, not by field-stripping.
        const svc = new LangyConversationService(
          visibleRepo(),
          makeCommands(),
          undefined,
          makeEvents([
            plainTurnEvent({
              id: "e1",
              createdAt: 100,
              type: "lw.langy_conversation.conversation_started",
              data: {
                conversationId: "c1",
                userId: "bob",
                runToken: "SECRET",
              },
            }),
            plainTurnEvent({ id: "e2", createdAt: 200 }),
          ]),
        );
        const result = await svc.getEventsAfter({
          projectId: "p1",
          conversationId: "c1",
          userId: "alice",
          after: { acceptedAt: 0, eventId: "" },
        });
        expect(result.events.map((e) => e.id)).toEqual(["e2"]);
        expect(JSON.stringify(result)).not.toContain("SECRET");
      });

      it("serves the wire envelope only — no tenant or aggregate fields", async () => {
        const svc = new LangyConversationService(
          visibleRepo(),
          makeCommands(),
          undefined,
          makeEvents([plainTurnEvent({ id: "e1", createdAt: 100 })]),
        );
        const result = await svc.getEventsAfter({
          projectId: "p1",
          conversationId: "c1",
          userId: "alice",
          after: { acceptedAt: 0, eventId: "" },
        });
        expect(Object.keys(result.events[0]!).sort()).toEqual([
          "createdAt",
          "data",
          "id",
          "occurredAt",
          "type",
        ]);
      });
    });

    describe("given a tail beyond the response ceiling", () => {
      it("cuts at the ceiling, flags truncation, and cursors at the cut", async () => {
        const events = Array.from({ length: 1_050 }, (_, i) =>
          plainTurnEvent({
            id: `e${String(i).padStart(5, "0")}`,
            createdAt: 1_000 + i,
          }),
        );
        const svc = new LangyConversationService(
          visibleRepo(),
          makeCommands(),
          undefined,
          makeEvents(events),
        );
        const result = await svc.getEventsAfter({
          projectId: "p1",
          conversationId: "c1",
          userId: "alice",
          after: { acceptedAt: 0, eventId: "" },
        });
        expect(result.truncated).toBe(true);
        expect(result.events).toHaveLength(1_000);
        const last = result.events.at(-1)!;
        expect(result.cursor).toEqual({
          acceptedAt: last.createdAt,
          eventId: last.id,
        });
      });
    });
  });
});
