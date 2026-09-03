import { LANGY_CONVERSATION_STATUS } from "@langwatch/langy-contract";
import { describe, expect, it, vi } from "vitest";
import {
  LangyTurnService,
  type LangyTurnServiceDeps,
  type StartConversationTurnInput,
} from "../langy-turn.service";

function makeFixture() {
  const acceptTurn = vi.fn(async () => undefined);
  const dispatch = vi.fn(async () => "accepted" as const);
  const deps = {
    conversations: {
      ensureConversation: vi.fn(async () => ({ id: "conversation-1", isNew: false })),
      tryFindByIdVisible: vi.fn(async () => ({ status: LANGY_CONVERSATION_STATUS.IDLE })),
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
    sessionKeys: {
      mint: vi.fn(async () => ({ token: "session-key", apiKeyId: "key-1" })),
      revoke: vi.fn(async () => undefined),
    },
    context: { render: vi.fn(() => null) },
    uiActionSurface: { resolve: vi.fn(async () => true) },
    metrics: { count: vi.fn() },
    admission: {
      claim: vi.fn(async () => ({
        kind: "claimed" as const,
        claimToken: "claim-1",
        conversationId: "conversation-1",
        turnId: "turn-1",
      })),
      commit: vi.fn(async () => undefined),
      abort: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    },
    accessStore: {
      grant: vi.fn(async () => undefined),
      isTurnActor: vi.fn(async () => true),
    },
    handoffStore: { stash: vi.fn(async () => undefined) },
    messages: { findAllByConversation: vi.fn(async () => []) },
  } as unknown as LangyTurnServiceDeps;
  return { deps, acceptTurn, dispatch };
}

const input: StartConversationTurnInput = {
  projectId: "project-1",
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  session: { user: { id: "user-1" } },
  requestedConversationId: null,
  messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
  isRetry: false,
  turnContext: {},
};

describe("LangyTurnService package boundary", () => {
  it("admits before it records and directly dispatches only after commit", async () => {
    const fixture = makeFixture();
    const result = await LangyTurnService.create(fixture.deps).startConversationTurn(input);
    expect(result).toEqual({ conversationId: "conversation-1", turnId: "turn-1" });
    expect(fixture.acceptTurn).toHaveBeenCalledOnce();
    expect(fixture.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation-1",
        intent: "create",
        modelOverride: "openai/gpt-5-mini",
      }),
    );
  });
});
