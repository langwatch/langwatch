/**
 * LangyTurnBaseDependenciesService resolves the harness once per turn and
 * threads it into credentials — from there it rides along on the worker
 * probe, the handoff stash, and the dispatch payload, unset when no harness
 * resolver is composed.
 */
import { describe, expect, it, vi } from "vitest";
import {
  LangyTurnService,
  type LangyTurnServiceDeps,
  type StartConversationTurnInput,
} from "../langy-turn.service";

function makeFixture(over: Partial<LangyTurnServiceDeps> = {}) {
  const probe = vi.fn(async () => false);
  const dispatch = vi.fn(async () => "accepted" as const);
  const stash = vi.fn(async () => undefined);

  const deps = {
    conversations: {
      ensureConversation: vi.fn(async () => ({ id: "conversation-1", isNew: false })),
      tryFindByIdVisible: vi.fn(async () => ({ status: "idle" })),
      tryGetPendingHandoff: vi.fn(async () => null),
      tryGetRunToken: vi.fn(async () => "run-token"),
      acceptTurn: vi.fn(async () => undefined),
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
      probe,
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
    handoffStore: { stash },
    messages: { findAllByConversation: vi.fn(async () => []) },
    ...over,
  } as unknown as LangyTurnServiceDeps;

  return { deps, probe, dispatch, stash };
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

describe("LangyTurnBaseDependenciesService harness resolution", () => {
  describe("when the harness flag resolves for the turn", () => {
    it("rides the harness on the probe, the handoff stash and the dispatch", async () => {
      const fixture = makeFixture({
        harness: { resolve: vi.fn(async () => "pi" as const) },
      } as unknown as Partial<LangyTurnServiceDeps>);

      await LangyTurnService.create(fixture.deps).startConversationTurn(input);

      expect(fixture.probe).toHaveBeenCalledWith(
        expect.objectContaining({ harness: "pi" }),
      );
      expect(fixture.stash).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: expect.objectContaining({ harness: "pi" }),
        }),
      );
      expect(fixture.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: expect.objectContaining({ harness: "pi" }),
        }),
      );
    });

    it("leaves the harness unset when no resolver is composed", async () => {
      const fixture = makeFixture();

      await LangyTurnService.create(fixture.deps).startConversationTurn(input);

      const probeArgs = fixture.probe.mock.calls[0]![0] as unknown as {
        harness?: string;
      };
      expect(probeArgs.harness).toBeUndefined();
    });
  });
});
