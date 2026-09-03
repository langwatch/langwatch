/**
 * The model a turn actually runs on: the project's configured default when
 * nothing overrides it, a per-send override that wins over it, and any
 * allowlisted provider's model dispatched with its full id (the engine is
 * provider-blind — no branch here may key on a provider name).
 *
 * Ported from platform/app/src/server/app-layer/langy/__tests__/langy-turn.service.unit.test.ts
 * (origin/main)'s `LangyTurnService.startConversationTurn` block, adapted to
 * the split `LangyTurnServiceDeps` (permits/sessionKeys/admission grouped,
 * `models.resolve` in place of the flat `resolveModel`), mirroring
 * langy-turn-preparation.service.unit.test.ts's fixture. See
 * specs/langy/langy-model-selection.feature.
 */
import { describe, expect, it, vi } from "vitest";
import {
  LangyTurnService,
  type LangyTurnServiceDeps,
  type StartConversationTurnInput,
} from "../langy-turn.service";

function makeDeps(over: Partial<LangyTurnServiceDeps> = {}) {
  const dispatch = vi.fn(async () => "accepted" as const);
  const resolve = vi.fn(async () => ({ modelId: "openai/gpt-5-mini" }));
  const tryGetModelsAllowed = vi.fn(async (): Promise<string[] | null> => null);

  const deps = {
    conversations: {
      ensureConversation: vi.fn(async () => ({ id: "conv-1", isNew: false })),
      tryFindByIdVisible: vi.fn(async () => null),
      tryGetPendingHandoff: vi.fn(async () => null),
      tryGetRunToken: vi.fn(async () => "run-token"),
      acceptTurn: vi.fn(async () => undefined),
      finalizeTurn: vi.fn(async () => undefined),
    },
    credentials: {
      getOrProvision: vi.fn(async () => ({ organizationId: "org-1" })),
      tryGetEgressAllowlist: vi.fn(async () => null),
      resolveMirrorTier: vi.fn(async () => "content" as const),
      tryGetModelsAllowed,
    },
    models: { resolve },
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
      mint: vi.fn(async () => ({ token: "sk", apiKeyId: "key-1" })),
      revoke: vi.fn(async () => undefined),
    },
    context: { render: vi.fn(() => null) },
    uiActionSurface: { resolve: vi.fn(async () => true) },
    metrics: { count: vi.fn() },
    admission: {
      claim: vi.fn(async () => ({
        kind: "claimed" as const,
        claimToken: "claim-1",
        conversationId: "conv-1",
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
    ...over,
  } as unknown as LangyTurnServiceDeps;

  return { deps, mocks: { dispatch, resolve, tryGetModelsAllowed } };
}

const input = (
  over: Partial<StartConversationTurnInput> = {},
): StartConversationTurnInput => ({
  projectId: "p1",
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  session: { user: { id: "user-1" } },
  requestedConversationId: null,
  messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
  isRetry: false,
  turnContext: {},
  ...over,
});

const dispatchedOf = (dispatch: ReturnType<typeof vi.fn>) =>
  dispatch.mock.calls[0]![0] as { modelOverride: string };

describe("LangyTurnService.startConversationTurn model forwarding", () => {
  /** @scenario Any allowed provider's model is dispatched with its full id */
  it.each([
    "anthropic/claude-sonnet-4-5",
    "gemini/gemini-2.5-pro",
    "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0",
  ])("accepts and forwards the allowed model %s verbatim", async (model) => {
    const { deps, mocks } = makeDeps();
    mocks.tryGetModelsAllowed.mockResolvedValue([model]);

    await LangyTurnService.create(deps).startConversationTurn(input({ modelOverride: model }));

    expect(dispatchedOf(mocks.dispatch).modelOverride).toBe(model);
  });

  /** @scenario A per-send override still wins over the configured Langy model */
  it("does not resolve an unused default model when an override is allowed", async () => {
    const { deps, mocks } = makeDeps();
    mocks.tryGetModelsAllowed.mockResolvedValue(["openai/gpt-5-mini"]);

    await LangyTurnService.create(deps).startConversationTurn(
      input({ modelOverride: "openai/gpt-5-mini" }),
    );

    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(dispatchedOf(mocks.dispatch).modelOverride).toBe("openai/gpt-5-mini");
  });

  /** @scenario The configured Langy model is forwarded to the worker */
  it("forwards the resolved default model to the worker when nothing overrides it", async () => {
    const { deps, mocks } = makeDeps();
    mocks.resolve.mockResolvedValue({ modelId: "anthropic/claude-opus-4-8" });

    await LangyTurnService.create(deps).startConversationTurn(input());

    expect(dispatchedOf(mocks.dispatch).modelOverride).toBe("anthropic/claude-opus-4-8");
  });
});
