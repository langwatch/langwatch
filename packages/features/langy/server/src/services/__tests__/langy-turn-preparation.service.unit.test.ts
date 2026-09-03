import { LANGY_CONVERSATION_STATUS, renderLangyTurnContext } from "@langwatch/langy-contract";
import { describe, expect, it, vi } from "vitest";
import {
  LangyTurnService,
  type LangyTurnServiceDeps,
  type StartConversationTurnInput,
} from "../langy-turn.service";

/**
 * Spec: specs/langy/langy-worker-prewarm.feature
 *
 * The reads LangyTurnPreparationService gates behind `conversation.isNew` are
 * lag-tolerant: asked about a conversation whose projection cannot exist yet,
 * `tryFindByIdVisible` spends its whole handoff grace window before answering
 * "not found" — a flat delay in front of every first message. A brand new
 * conversation has no projection row by construction, so the preparation step
 * must skip both reads rather than pay that wait.
 */
function makeFixture(over: Partial<LangyTurnServiceDeps> = {}) {
  const tryFindByIdVisible = vi.fn(async () => ({
    status: LANGY_CONVERSATION_STATUS.IDLE,
  }));
  const tryGetPendingHandoff = vi.fn(async () => null);
  const dispatch = vi.fn(async () => "accepted" as const);
  const acceptTurn = vi.fn(async () => undefined);

  const deps = {
    conversations: {
      ensureConversation: vi.fn(async () => ({ id: "conversation-1", isNew: true })),
      tryFindByIdVisible,
      tryGetPendingHandoff,
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
    ...over,
  } as unknown as LangyTurnServiceDeps;

  return { deps, tryFindByIdVisible, tryGetPendingHandoff, dispatch, acceptTurn };
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

describe("LangyTurnService.startConversationTurn", () => {
  describe("given the admission claims a brand new conversation", () => {
    /** @scenario The first message of a new conversation does not wait for its own projection */
    it("skips the projection and handoff reads for a new conversation", async () => {
      const fixture = makeFixture();

      const result = await LangyTurnService.create(fixture.deps).startConversationTurn(
        input,
      );

      expect(result).toEqual({ conversationId: "conversation-1", turnId: "turn-1" });
      // Both reads are lag-tolerant: asked about a conversation whose
      // projection cannot exist yet, they would spend their whole grace
      // window before answering "not found" — a flat delay in front of
      // every first message.
      expect(fixture.tryFindByIdVisible).not.toHaveBeenCalled();
      expect(fixture.tryGetPendingHandoff).not.toHaveBeenCalled();
      expect(fixture.dispatch).toHaveBeenCalledOnce();
    });
  });
});

/**
 * Spec: specs/langy/langy-ui-actions.feature
 *
 * The turn block advertises `langwatch ui actions` only while the dispatch
 * route would answer it. The real context renderer is used so the assertion
 * reads the prompt the worker is handed, not a call on a double.
 */
describe("LangyTurnService.startConversationTurn ui-action surface", () => {
  describe("when the page the user is on accepts live UI actions", () => {
    /** The chip kind that maps to a page manifest today. */
    const experimentContext = {
      pageContext: [{ kind: "experiment" as const, ref: "my-exp", label: "my-exp" }],
    } as StartConversationTurnInput["turnContext"];

    const promptFor = async (isSurfaceOpen: boolean) => {
      const fixture = makeFixture({
        context: { render: renderLangyTurnContext },
        uiActionSurface: { resolve: vi.fn(async () => isSurfaceOpen) },
      } as unknown as Partial<LangyTurnServiceDeps>);
      await LangyTurnService.create(fixture.deps).startConversationTurn({
        ...input,
        turnContext: experimentContext,
      });
      expect(fixture.dispatch).toHaveBeenCalledOnce();
      const [dispatched] = fixture.dispatch.mock.calls[0] as unknown as [{ prompt: string }];
      return dispatched.prompt;
    };

    it("offers the UI-action commands while the surface is open", async () => {
      expect(await promptFor(true)).toContain("langwatch ui actions");
    });

    /** @scenario With page control rolled back, the agent is never offered the ui commands */
    it("stays quiet about them while the surface is closed", async () => {
      // The dispatch route answers a dark 404 with the flag off, so naming the
      // commands would send the agent to a path that looks undeployed.
      const prompt = await promptFor(false);
      expect(prompt).not.toContain("langwatch ui actions");
      // The rest of the screen context still travels.
      expect(prompt).toContain("my-exp");
    });
  });
});
