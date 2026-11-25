/**
 * LangyTurnStartService owns admission: it claims the durable slot before any preparation work
 * runs, and rejects fast on a busy/mismatched/replayed claim or an unconfigured model — before
 * ever touching the worker, session keys, or the acceptance command.
 */
import {
  LangyAgentUnavailableError,
  LangyEmptyMessageError,
  LangyIdempotencyMismatchError,
  LangyModelNotConfiguredError,
  LangyTurnInProgressError,
} from "@langwatch/langy-contract";
import { describe, expect, it, vi } from "vitest";

import {
  langyTurnDeps,
  type LangyTurnDepsOverrides,
  workerCredentials,
  conversationDetail,
} from "../../../../__tests__/support/langy-turn-deps.ts";
import { LangyTurnService, type StartConversationTurnInput } from "../langy-turn.service.ts";

function makeFixture(
  over: LangyTurnDepsOverrides = {},
  findByIdVisible = vi.fn(async () => conversationDetail({ status: "idle" })),
) {
  const ensureConversation = vi.fn(async () => ({ id: "conversation-1", isNew: false }));
  const acceptTurn = vi.fn(async () => ({ turnId: "turn-1" }));
  const dispatch = vi.fn(async () => "accepted" as const);
  const claim = vi.fn(
    async ({ conversationId, turnId }: { conversationId: string; turnId: string }) => ({
      kind: "claimed" as const,
      claimToken: "claim-1",
      conversationId,
      turnId,
    }),
  );
  const commit = vi.fn(async () => undefined);
  const abort = vi.fn(async () => undefined);
  const mint = vi.fn(async () => ({ token: "session-key", apiKeyId: "key-1" }));

  const deps = langyTurnDeps({
    conversations: {
      ensureConversation,
      findByIdVisible,
      findPendingHandoff: vi.fn(async () => null),
      findRunToken: vi.fn(async () => "run-token"),
      acceptTurn,
      finalizeTurn: vi.fn(async () => ({ messageId: "message-1" })),
    },
    credentials: {
      getOrProvision: vi.fn(async () => workerCredentials({ organizationId: "organization-1" })),
      findEgressAllowlist: vi.fn(async () => null),
      resolveMirrorTier: vi.fn(async () => "content" as const),
      findModelsAllowed: vi.fn(async () => null),
    },
    models: { resolve: vi.fn(async () => ({ modelId: "openai/gpt-5-mini" })) },
    worker: {
      probe: vi.fn(async () => false),
      dispatch,
      cancel: vi.fn(async () => undefined),
      warm: vi.fn(async () => undefined),
    },
    permits: {
      check: vi.fn(async () => ({ allowed: true, resetAt: 0 })),
    },
    perDayPrCap: 5,
    sessionKeys: { mint, revoke: vi.fn(async () => undefined) },
    context: { render: vi.fn(() => null) },
    uiActionSurface: { resolve: vi.fn(async () => true) },
    skillGates: { resolveDisabled: vi.fn(async () => []) },
    metrics: { count: vi.fn() },
    admission: { claim, commit, abort, release: vi.fn(async () => undefined) },
    accessStore: {
      grant: vi.fn(async () => undefined),
      isTurnActor: vi.fn(async () => true),
    },
    handoffStore: { stash: vi.fn(async () => undefined) },
    messages: { findAllByConversation: vi.fn(async () => []) },
    ...over,
  });

  return { deps, ensureConversation, acceptTurn, dispatch, claim, commit, abort, mint };
}

const input = (over: Partial<StartConversationTurnInput> = {}): StartConversationTurnInput => ({
  projectId: "project-1",
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  session: { user: { id: "user-1" } } as StartConversationTurnInput["session"],
  requestedConversationId: null,
  messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
  isRetry: false,
  turnContext: {},
  ...over,
});

describe("LangyTurnStartService", () => {
  describe("given the idempotency key is reused with different content", () => {
    it("rejects with the mismatch error instead of replaying the original send", async () => {
      const fixture = makeFixture({
        admission: {
          claim: vi.fn(async () => ({ kind: "mismatch" as const })),
          commit: vi.fn(async () => undefined),
          confirmAccepted: vi.fn(async () => undefined),
          abort: vi.fn(async () => undefined),
          release: vi.fn(async () => undefined),
        },
      });

      await expect(
        LangyTurnService.create(fixture.deps).startConversationTurn(input()),
      ).rejects.toBeInstanceOf(LangyIdempotencyMismatchError);
    });
  });

  describe("given the send carries no usable text", () => {
    it("rejects before admitting anything durable", async () => {
      const fixture = makeFixture();

      await expect(
        LangyTurnService.create(fixture.deps).startConversationTurn(
          input({ messages: [{ role: "user", parts: [] }] }),
        ),
      ).rejects.toBeInstanceOf(LangyEmptyMessageError);
      expect(fixture.claim).not.toHaveBeenCalled();
      expect(fixture.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("given an authoritative busy admission", () => {
    it("rejects an authoritative busy admission before probing or minting", async () => {
      const probe = vi.fn(async () => false);
      const fixture = makeFixture({
        admission: {
          claim: vi.fn(async () => ({
            kind: "busy" as const,
            conversationId: "conversation-1",
            heldTurnId: "turn-running",
          })),
          commit: vi.fn(async () => undefined),
          confirmAccepted: vi.fn(async () => undefined),
          abort: vi.fn(async () => undefined),
          release: vi.fn(async () => undefined),
        },
        worker: {
          probe,
          dispatch: vi.fn(async () => "accepted" as const),
          cancel: vi.fn(async () => undefined),
          warm: vi.fn(async () => undefined),
        },
      });

      await expect(
        LangyTurnService.create(fixture.deps).startConversationTurn(input()),
      ).rejects.toBeInstanceOf(LangyTurnInProgressError);

      expect(probe).not.toHaveBeenCalled();
      expect(fixture.mint).not.toHaveBeenCalled();
      expect(fixture.acceptTurn).not.toHaveBeenCalled();
    });
  });

  describe("given the turn holding the conversation already ended on its live edge", () => {
    const ended = {
      readTail: vi.fn(async () => ({
        reads: [
          { id: "1-0", entry: { type: "delta" as const, text: "done" } },
          { id: "2-0", entry: { type: "end" as const } },
        ],
        lastId: "2-0",
      })),
    };
    const busy = {
      kind: "busy" as const,
      conversationId: "conversation-1",
      heldTurnId: "turn-ended",
    };

    /** @scenario A message sent right after a reply ends waits for the reply to be saved */
    it("waits for the ended turn to release the conversation, then admits the send", async () => {
      const claim = vi
        .fn()
        .mockResolvedValueOnce(busy)
        .mockResolvedValueOnce(busy)
        .mockImplementation(async ({ conversationId, turnId }) => ({
          kind: "claimed" as const,
          claimToken: "claim-1",
          conversationId,
          turnId,
        }));
      const fixture = makeFixture({
        tokenBuffer: ended,
        endedTurnWait: { waitMs: 1_000, pollMs: 1 },
        admission: {
          claim,
          commit: vi.fn(async () => undefined),
          confirmAccepted: vi.fn(async () => undefined),
          abort: vi.fn(async () => undefined),
          release: vi.fn(async () => undefined),
        },
      });

      await expect(
        LangyTurnService.create(fixture.deps).startConversationTurn(input()),
      ).resolves.toMatchObject({ conversationId: "conversation-1" });
      expect(claim).toHaveBeenCalledTimes(3);
      expect(fixture.dispatch).toHaveBeenCalledOnce();
    });

    /** @scenario A reply whose save outlasts the wait answers retry shortly, not still replying */
    it("answers retry shortly when the release outlasts the wait", async () => {
      const fixture = makeFixture({
        tokenBuffer: ended,
        endedTurnWait: { waitMs: 5, pollMs: 1 },
        admission: {
          claim: vi.fn(async () => busy),
          commit: vi.fn(async () => undefined),
          confirmAccepted: vi.fn(async () => undefined),
          abort: vi.fn(async () => undefined),
          release: vi.fn(async () => undefined),
        },
      });

      await expect(
        LangyTurnService.create(fixture.deps).startConversationTurn(input()),
      ).rejects.toBeInstanceOf(LangyAgentUnavailableError);
      expect(fixture.dispatch).not.toHaveBeenCalled();
    });

    /** @scenario A fold that still reads running for an ended turn does not refuse the send */
    it("waits for the fold of the ended turn instead of refusing the send as busy", async () => {
      const findByIdVisible = vi
        .fn()
        .mockResolvedValueOnce(
          conversationDetail({ status: "running", currentTurnId: "turn-ended" }),
        )
        .mockResolvedValueOnce(
          conversationDetail({ status: "running", currentTurnId: "turn-ended" }),
        )
        .mockResolvedValue(conversationDetail({ status: "idle" }));
      const fixture = makeFixture(
        { tokenBuffer: ended, endedTurnWait: { waitMs: 1_000, pollMs: 1 } },
        findByIdVisible,
      );

      await expect(
        LangyTurnService.create(fixture.deps).startConversationTurn(input()),
      ).resolves.toMatchObject({ conversationId: "conversation-1" });
      expect(findByIdVisible).toHaveBeenCalledTimes(3);
      expect(fixture.dispatch).toHaveBeenCalledOnce();
    });
  });

  describe("given the turn holding the conversation is still replying", () => {
    /** @scenario A send while Langy is still replying is refused at once */
    it("refuses the send as in progress without waiting", async () => {
      const claim = vi.fn(async () => ({
        kind: "busy" as const,
        conversationId: "conversation-1",
        heldTurnId: "turn-running",
      }));
      const fixture = makeFixture({
        tokenBuffer: {
          readTail: vi.fn(async () => ({
            reads: [{ id: "1-0", entry: { type: "delta" as const, text: "still going" } }],
            lastId: "1-0",
          })),
        },
        endedTurnWait: { waitMs: 1_000, pollMs: 1 },
        admission: {
          claim,
          commit: vi.fn(async () => undefined),
          confirmAccepted: vi.fn(async () => undefined),
          abort: vi.fn(async () => undefined),
          release: vi.fn(async () => undefined),
        },
      });

      await expect(
        LangyTurnService.create(fixture.deps).startConversationTurn(input()),
      ).rejects.toBeInstanceOf(LangyTurnInProgressError);
      expect(claim).toHaveBeenCalledOnce();
    });
  });

  describe("given no default model is configured", () => {
    it("fails before admission when no default model is configured", async () => {
      const fixture = makeFixture({
        models: {
          resolve: vi.fn(async () => {
            throw new LangyModelNotConfiguredError();
          }),
        },
      });

      await expect(
        LangyTurnService.create(fixture.deps).startConversationTurn(input()),
      ).rejects.toBeInstanceOf(LangyModelNotConfiguredError);
      expect(fixture.claim).not.toHaveBeenCalled();
    });
  });

  describe("given the admission replays an already-accepted claim", () => {
    it("replays the original ids without minting or dispatching a second time", async () => {
      const claim = vi
        .fn()
        .mockResolvedValueOnce({
          kind: "claimed" as const,
          claimToken: "claim-1",
          conversationId: "conversation-1",
          turnId: "turn-1",
        })
        .mockResolvedValueOnce({
          kind: "replay" as const,
          conversationId: "conversation-1",
          turnId: "turn-1",
        });
      const fixture = makeFixture({
        admission: {
          claim,
          commit: vi.fn(async () => undefined),
          confirmAccepted: vi.fn(async () => undefined),
          abort: vi.fn(async () => undefined),
          release: vi.fn(async () => undefined),
        },
      });
      const service = LangyTurnService.create(fixture.deps);

      await service.startConversationTurn(input());
      const replay = await service.startConversationTurn(input());

      expect(replay).toEqual({ conversationId: "conversation-1", turnId: "turn-1" });
      expect(fixture.mint).toHaveBeenCalledOnce();
      expect(fixture.acceptTurn).toHaveBeenCalledOnce();
      expect(fixture.dispatch).toHaveBeenCalledOnce();
    });
  });

  describe("when the first message adopts a warmed conversation id", () => {
    /** @scenario The first message adopts the warmed conversation */
    it("threads adoptUnknownId so the turn lands on the warmed aggregate", async () => {
      const fixture = makeFixture();
      fixture.ensureConversation.mockResolvedValue({
        id: "conv-warmed",
        isNew: true,
      });

      await LangyTurnService.create(fixture.deps).startConversationTurn(
        input({
          requestedConversationId: "conv-warmed",
          adoptConversationId: true,
        }),
      );

      expect(fixture.ensureConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv-warmed",
          adoptUnknownId: true,
        }),
      );
      expect(fixture.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: "conv-warmed" }),
      );
    });
  });
});
