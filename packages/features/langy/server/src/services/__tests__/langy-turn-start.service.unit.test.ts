/**
 * LangyTurnStartService owns admission: it claims the durable slot before any
 * preparation work runs, and rejects fast on a busy/mismatched/replayed claim
 * or an unconfigured model — before ever touching the worker, session keys,
 * or the acceptance command. Exercised through the public LangyTurnService
 * facade, since the collaborator itself has no public surface of its own.
 */
import {
  LangyEmptyMessageError,
  LangyIdempotencyMismatchError,
  LangyModelNotConfiguredError,
  LangyTurnInProgressError,
} from "@langwatch/langy-contract";
import { describe, expect, it, vi } from "vitest";
import {
  LangyTurnService,
  type LangyTurnServiceDeps,
  type StartConversationTurnInput,
} from "../langy-turn.service";

function makeFixture(over: Partial<LangyTurnServiceDeps> = {}) {
  const ensureConversation = vi.fn(async () => ({ id: "conversation-1", isNew: false }));
  const acceptTurn = vi.fn(async () => undefined);
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

  const deps = {
    conversations: {
      ensureConversation,
      tryFindByIdVisible: vi.fn(async () => ({ status: "idle" })),
      tryGetPendingHandoff: vi.fn(async () => null),
      tryGetRunToken: vi.fn(async () => "run-token"),
      acceptTurn,
      finalizeTurn: vi.fn(async () => undefined),
    },
    credentials: {
      getOrProvision: vi.fn(async () => ({ organizationId: "organization-1" })),
      tryGetEgressAllowlist: vi.fn(async () => null),
      resolveMirrorTier: vi.fn(async () => "content" as const),
      tryGetModelsAllowed: vi.fn(async () => null),
    },
    models: { resolve: vi.fn(async () => ({ modelId: "openai/gpt-5-mini" })) },
    worker: {
      probe: vi.fn(async () => false),
      dispatch,
      cancel: vi.fn(async () => undefined),
      warm: vi.fn(async () => undefined),
    },
    tokenBuffer: null,
    permits: {
      reserve: vi.fn(async () => ({ reserved: false, allowed: true, resetAt: 0 })),
      release: vi.fn(async () => undefined),
      check: vi.fn(async () => ({ allowed: true })),
    },
    perDayPrCap: 5,
    sessionKeys: { mint, revoke: vi.fn(async () => undefined) },
    context: { render: vi.fn(() => null) },
    uiActionSurface: { resolve: vi.fn(async () => true) },
    metrics: { count: vi.fn() },
    admission: { claim, commit, abort, release: vi.fn(async () => undefined) },
    accessStore: {
      grant: vi.fn(async () => undefined),
      isTurnActor: vi.fn(async () => true),
    },
    handoffStore: { stash: vi.fn(async () => undefined) },
    messages: { findAllByConversation: vi.fn(async () => []) },
    ...over,
  } as unknown as LangyTurnServiceDeps;

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
          abort: vi.fn(async () => undefined),
          release: vi.fn(async () => undefined),
        },
      } as unknown as Partial<LangyTurnServiceDeps>);

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
          claim: vi.fn(async () => ({ kind: "busy" as const })),
          commit: vi.fn(async () => undefined),
          abort: vi.fn(async () => undefined),
          release: vi.fn(async () => undefined),
        },
        worker: {
          probe,
          dispatch: vi.fn(async () => "accepted" as const),
          cancel: vi.fn(async () => undefined),
          warm: vi.fn(async () => undefined),
        },
      } as unknown as Partial<LangyTurnServiceDeps>);

      await expect(
        LangyTurnService.create(fixture.deps).startConversationTurn(input()),
      ).rejects.toBeInstanceOf(LangyTurnInProgressError);

      expect(probe).not.toHaveBeenCalled();
      expect(fixture.mint).not.toHaveBeenCalled();
      expect(fixture.acceptTurn).not.toHaveBeenCalled();
    });
  });

  describe("given no default model is configured", () => {
    it("fails before admission when no default model is configured", async () => {
      const fixture = makeFixture({
        models: { resolve: vi.fn(async () => ({ modelId: null })) },
      } as unknown as Partial<LangyTurnServiceDeps>);

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
          abort: vi.fn(async () => undefined),
          release: vi.fn(async () => undefined),
        },
      } as unknown as Partial<LangyTurnServiceDeps>);
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
