import {
  LANGY_CONVERSATION_STATUS,
  LangyAgentUnavailableError,
  LangyModelNotAllowedError,
  LangyTurnInProgressError,
  renderLangyTurnContext,
} from "@langwatch/langy-contract";
import { describe, expect, it, vi } from "vitest";

import {
  langyTurnDeps,
  type LangyTurnDepsOverrides,
  workerCredentials,
  conversationDetail,
} from "../../__tests__/support/langy-turn-deps.ts";
import type { LangyWorker } from "../../channels/langy-worker.channel.ts";
import { LangyTurnService, type StartConversationTurnInput } from "../langy-turn.service.ts";

/**
 * Spec: specs/langy/langy-worker-prewarm.feature
 */
function makeFixture(over: LangyTurnDepsOverrides = {}) {
  const findByIdVisible = vi.fn(async () =>
    conversationDetail({ status: LANGY_CONVERSATION_STATUS.IDLE }),
  );
  const findPendingHandoff = vi.fn(async () => null);
  const dispatch = vi.fn<LangyWorker["dispatch"]>(async () => "accepted");
  const acceptTurn = vi.fn(async () => ({ turnId: "turn-1" }));

  const deps = langyTurnDeps({
    conversations: {
      ensureConversation: vi.fn(async () => ({ id: "conversation-1", isNew: true })),
      findByIdVisible,
      findPendingHandoff,
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
    ...over,
  });

  return { deps, findByIdVisible, findPendingHandoff, dispatch, acceptTurn };
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

      const result = await LangyTurnService.create(fixture.deps).startConversationTurn(input);

      expect(result).toEqual({ conversationId: "conversation-1", turnId: "turn-1" });
      // Both reads are lag-tolerant: asked about a conversation whose
      // projection cannot exist yet, they would spend their whole grace
      // window before answering "not found" — a flat delay in front of
      // every first message.
      expect(fixture.findByIdVisible).not.toHaveBeenCalled();
      expect(fixture.findPendingHandoff).not.toHaveBeenCalled();
      expect(fixture.dispatch).toHaveBeenCalledOnce();
    });
  });
});

/**
 * Spec: specs/langy/langy-ui-actions.feature
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
      });
      await LangyTurnService.create(fixture.deps).startConversationTurn({
        ...input,
        turnContext: experimentContext,
      });
      expect(fixture.dispatch).toHaveBeenCalledOnce();
      const dispatched = fixture.dispatch.mock.calls[0]?.[0];
      return dispatched?.prompt;
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

    /** @scenario A flag-store blip must not stop the turn, and must not advertise a surface it could not confirm */
    it("starts the turn with the channel closed when the flag store fails", async () => {
      const fixture = makeFixture({
        context: { render: renderLangyTurnContext },
        uiActionSurface: {
          resolve: vi.fn(async () => {
            throw new Error("flag store unavailable");
          }),
        },
      });

      await LangyTurnService.create(fixture.deps).startConversationTurn({
        ...input,
        turnContext: experimentContext,
      });

      const dispatched = fixture.dispatch.mock.calls[0]?.[0];
      expect(dispatched?.prompt).not.toContain("langwatch ui actions");
      expect(dispatched?.prompt).toContain("my-exp");
    });
  });
});

/**
 * The acceptance command and the fast-path dispatch are what
 * LangyTurnPreparationService.prepareAndDispatch exists to produce, atomically
 * with the durable admission commit — the golden path a turn takes end to end.
 */
describe("LangyTurnPreparationService golden path", () => {
  it("commits one atomic message + acceptance command and fast-dispatches it", async () => {
    const fixture = makeFixture();

    const result = await LangyTurnService.create(fixture.deps).startConversationTurn(input);

    expect(result).toEqual({ conversationId: "conversation-1", turnId: "turn-1" });
    expect(fixture.acceptTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        questionParts: [{ type: "text", text: "hello" }],
        userMessage: expect.objectContaining({
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        }),
      }),
    );
    expect(fixture.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        userId: "user-1",
        conversationId: "conversation-1",
        turnId: "turn-1",
      }),
    );
  });

  it("atomically prefixes a new conversation with its owner and run token", async () => {
    const fixture = makeFixture();

    await LangyTurnService.create(fixture.deps).startConversationTurn(input);

    expect(fixture.acceptTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationStart: expect.objectContaining({
          userId: "user-1",
          runToken: expect.any(String),
        }),
        userMessage: expect.objectContaining({ role: "user" }),
      }),
    );
  });

  it("omits message_recorded when explicitly re-driving an existing message", async () => {
    const fixture = makeFixture();

    await LangyTurnService.create(fixture.deps).startConversationTurn({
      ...input,
      isRetry: true,
    });

    expect(fixture.acceptTurn).toHaveBeenCalledWith(
      expect.not.objectContaining({ userMessage: expect.anything() }),
    );
  });

  it("does not mint when the principal-bound worker probe hits", async () => {
    const mint = vi.fn(async () => ({ token: "session-key", apiKeyId: "key-1" }));
    const probe = vi.fn(async () => true);
    const dispatch = vi.fn(async () => "accepted" as const);
    const fixture = makeFixture({
      worker: {
        probe,
        dispatch,
        cancel: vi.fn(async () => undefined),
        warm: vi.fn(async () => undefined),
      },
      sessionKeys: { mint, revoke: vi.fn(async () => undefined) },
    });

    await LangyTurnService.create(fixture.deps).startConversationTurn(input);

    expect(mint).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ intent: "continue" }));
  });

  it("finalizes the GitHub permit before probing the worker signature", async () => {
    const order: string[] = [];
    const reserve = vi.fn(async () => {
      order.push("permit");
      return { reserved: false, allowed: false, resetAt: Date.now() + 60_000 };
    });
    const probe = vi.fn(async ({ hasGithubAuth }: { hasGithubAuth: boolean }) => {
      order.push(`probe:${String(hasGithubAuth)}`);
      return false;
    });
    const dispatch = vi.fn(async () => "accepted" as const);
    const fixture = makeFixture({
      credentials: {
        getOrProvision: vi.fn(async () =>
          workerCredentials({
            organizationId: "organization-1",
            githubToken: "gh-token",
            githubLogin: "octocat",
          }),
        ),
        findEgressAllowlist: vi.fn(async () => null),
        resolveMirrorTier: vi.fn(async () => "content" as const),
        findModelsAllowed: vi.fn(async () => null),
      },
      permits: {
        reserve,
        release: vi.fn(async () => undefined),
        check: vi.fn(async () => ({ allowed: true })),
      },
      worker: {
        probe,
        dispatch,
        cancel: vi.fn(async () => undefined),
        warm: vi.fn(async () => undefined),
      },
    });

    await LangyTurnService.create(fixture.deps).startConversationTurn(input);

    expect(order).toEqual(["permit", "probe:false"]);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.not.objectContaining({ githubToken: expect.anything() }),
      }),
    );
  });

  it("keeps the projection guard only as rollout defence and aborts its claim", async () => {
    const abort = vi.fn(async () => undefined);
    const fixture = makeFixture({
      conversations: {
        ensureConversation: vi.fn(async () => ({ id: "conversation-1", isNew: false })),
        findByIdVisible: vi.fn(async () =>
          conversationDetail({ status: LANGY_CONVERSATION_STATUS.RUNNING }),
        ),
        findPendingHandoff: vi.fn(async () => null),
        findRunToken: vi.fn(async () => "run-token"),
        acceptTurn: vi.fn(async () => ({ turnId: "turn-1" })),
        finalizeTurn: vi.fn(async () => ({ messageId: "message-1" })),
      },
      admission: {
        claim: vi.fn(async () => ({
          kind: "claimed" as const,
          claimToken: "claim-1",
          conversationId: "conversation-1",
          turnId: "turn-1",
        })),
        commit: vi.fn(async () => undefined),
        abort,
        release: vi.fn(async () => undefined),
      },
    });

    await expect(
      LangyTurnService.create(fixture.deps).startConversationTurn(input),
    ).rejects.toBeInstanceOf(LangyTurnInProgressError);

    expect(abort).toHaveBeenCalledOnce();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("rejects a disallowed model and releases the admission", async () => {
    const abort = vi.fn(async () => undefined);
    const reserve = vi.fn(async () => ({ reserved: false, allowed: true, resetAt: 0 }));
    const fixture = makeFixture({
      credentials: {
        getOrProvision: vi.fn(async () => workerCredentials({ organizationId: "organization-1" })),
        findEgressAllowlist: vi.fn(async () => null),
        resolveMirrorTier: vi.fn(async () => "content" as const),
        findModelsAllowed: vi.fn(async () => ["openai/gpt-5-mini"]),
      },
      permits: {
        reserve,
        release: vi.fn(async () => undefined),
        check: vi.fn(async () => ({ allowed: true })),
      },
      admission: {
        claim: vi.fn(async () => ({
          kind: "claimed" as const,
          claimToken: "claim-1",
          conversationId: "conversation-1",
          turnId: "turn-1",
        })),
        commit: vi.fn(async () => undefined),
        abort,
        release: vi.fn(async () => undefined),
      },
    });

    await expect(
      LangyTurnService.create(fixture.deps).startConversationTurn({
        ...input,
        modelOverride: "evil/model",
      }),
    ).rejects.toBeInstanceOf(LangyModelNotAllowedError);

    expect(abort).toHaveBeenCalledOnce();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("rejects a resolved default that is not on the allowlist before dispatch", async () => {
    const fixture = makeFixture({
      models: { resolve: vi.fn(async () => ({ modelId: "anthropic/claude-opus-4-8" })) },
      credentials: {
        getOrProvision: vi.fn(async () => workerCredentials({ organizationId: "organization-1" })),
        findEgressAllowlist: vi.fn(async () => null),
        resolveMirrorTier: vi.fn(async () => "content" as const),
        findModelsAllowed: vi.fn(async () => ["openai/gpt-5-mini"]),
      },
    });

    await expect(
      LangyTurnService.create(fixture.deps).startConversationTurn(input),
    ).rejects.toBeInstanceOf(LangyModelNotAllowedError);

    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("revokes the key, releases the permit, and aborts when acceptance fails", async () => {
    const revoke = vi.fn(async () => undefined);
    const release = vi.fn(async () => undefined);
    const abort = vi.fn(async () => undefined);
    const acceptTurn = vi.fn(async () => {
      throw new Error("event store failed");
    });
    const fixture = makeFixture({
      credentials: {
        getOrProvision: vi.fn(async () =>
          workerCredentials({
            organizationId: "organization-1",
            githubToken: "gh-token",
          }),
        ),
        findEgressAllowlist: vi.fn(async () => null),
        resolveMirrorTier: vi.fn(async () => "content" as const),
        findModelsAllowed: vi.fn(async () => null),
      },
      conversations: {
        ensureConversation: vi.fn(async () => ({ id: "conversation-1", isNew: false })),
        findByIdVisible: vi.fn(async () =>
          conversationDetail({ status: LANGY_CONVERSATION_STATUS.IDLE }),
        ),
        findPendingHandoff: vi.fn(async () => null),
        findRunToken: vi.fn(async () => "run-token"),
        acceptTurn,
        finalizeTurn: vi.fn(async () => ({ messageId: "message-1" })),
      },
      sessionKeys: {
        mint: vi.fn(async () => ({ token: "session-key", apiKeyId: "key-1" })),
        revoke,
      },
      permits: {
        reserve: vi.fn(async () => ({ reserved: true, allowed: true, resetAt: 0 })),
        release,
        check: vi.fn(async () => ({ allowed: true })),
      },
      admission: {
        claim: vi.fn(async () => ({
          kind: "claimed" as const,
          claimToken: "claim-1",
          conversationId: "conversation-1",
          turnId: "turn-1",
        })),
        commit: vi.fn(async () => undefined),
        abort,
        release: vi.fn(async () => undefined),
      },
    });

    await expect(
      LangyTurnService.create(fixture.deps).startConversationTurn(input),
    ).rejects.toMatchObject({ code: "langy_agent_unavailable" });

    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith({ apiKeyId: "key-1", projectId: "project-1" });
    expect(release).toHaveBeenCalledWith({ userId: "user-1" });
    expect(abort).toHaveBeenCalledOnce();
  });

  it("does not fast-dispatch until the durable replay receipt commits", async () => {
    let resolveCommit!: () => void;
    const commit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCommit = resolve;
        }),
    );
    const fixture = makeFixture({
      admission: {
        claim: vi.fn(async () => ({
          kind: "claimed" as const,
          claimToken: "claim-1",
          conversationId: "conversation-1",
          turnId: "turn-1",
        })),
        commit,
        confirmAccepted: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
        release: vi.fn(async () => undefined),
      },
    });

    const result = LangyTurnService.create(fixture.deps).startConversationTurn(input);
    await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
    expect(fixture.dispatch).not.toHaveBeenCalled();
    resolveCommit();
    await result;
    expect(fixture.dispatch).toHaveBeenCalledOnce();
  });

  it("leaves eager dispatch to the outbox when receipt commit is unconfirmed", async () => {
    const fixture = makeFixture({
      admission: {
        claim: vi.fn(async () => ({
          kind: "claimed" as const,
          claimToken: "claim-1",
          conversationId: "conversation-1",
          turnId: "turn-1",
        })),
        commit: vi.fn(async () => {
          throw new Error("postgres unavailable");
        }),
        confirmAccepted: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
        release: vi.fn(async () => undefined),
      },
    });

    await expect(
      LangyTurnService.create(fixture.deps).startConversationTurn(input),
    ).resolves.toEqual({ conversationId: "conversation-1", turnId: "turn-1" });

    expect(fixture.acceptTurn).toHaveBeenCalledOnce();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("consumes a pending handoff in the same acceptance command", async () => {
    const acceptTurn = vi.fn(async () => ({ turnId: "turn-1" }));
    const fixture = makeFixture({
      conversations: {
        ensureConversation: vi.fn(async () => ({ id: "conversation-1", isNew: false })),
        findByIdVisible: vi.fn(async () =>
          conversationDetail({ status: LANGY_CONVERSATION_STATUS.IDLE }),
        ),
        findPendingHandoff: vi.fn(async () => ({ turnId: "old-turn", token: "checkpoint" })),
        findRunToken: vi.fn(async () => "run-token"),
        acceptTurn,
        finalizeTurn: vi.fn(async () => ({ messageId: "message-1" })),
      },
    });

    await LangyTurnService.create(fixture.deps).startConversationTurn(input);

    expect(acceptTurn).toHaveBeenCalledWith(
      expect.objectContaining({ consumeHandoffTurnId: "old-turn" }),
    );
    expect(fixture.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "revive", resumeToken: "checkpoint" }),
    );
  });
});

/**
 * The runToken is the HMAC key the worker signs every frame with, and the relay verifies
 * against.
 */
describe("when the conversation's runToken cannot be resolved", () => {
  /** @scenario Langy reports the agent unavailable instead of hanging the turn */
  it("refuses the turn when the runToken read fails", async () => {
    const fixture = makeFixture({
      conversations: {
        ensureConversation: vi.fn(async () => ({ id: "conversation-1", isNew: false })),
        findByIdVisible: vi.fn(async () =>
          conversationDetail({ status: LANGY_CONVERSATION_STATUS.IDLE }),
        ),
        findPendingHandoff: vi.fn(async () => null),
        findRunToken: vi.fn(async () => {
          throw new Error("postgres unavailable");
        }),
        acceptTurn: vi.fn(async () => ({ turnId: "turn-1" })),
        finalizeTurn: vi.fn(async () => ({ messageId: "message-1" })),
      },
    });

    await expect(
      LangyTurnService.create(fixture.deps).startConversationTurn(input),
    ).rejects.toBeInstanceOf(LangyAgentUnavailableError);

    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  /** @scenario Langy reports the agent unavailable instead of hanging the turn */
  it("refuses the turn when the conversation carries no runToken", async () => {
    const fixture = makeFixture({
      conversations: {
        ensureConversation: vi.fn(async () => ({ id: "conversation-1", isNew: false })),
        findByIdVisible: vi.fn(async () =>
          conversationDetail({ status: LANGY_CONVERSATION_STATUS.IDLE }),
        ),
        findPendingHandoff: vi.fn(async () => null),
        findRunToken: vi.fn(async (): Promise<string | null> => null),
        acceptTurn: vi.fn(async () => ({ turnId: "turn-1" })),
        finalizeTurn: vi.fn(async () => ({ messageId: "message-1" })),
      },
    });

    await expect(
      LangyTurnService.create(fixture.deps).startConversationTurn(input),
    ).rejects.toBeInstanceOf(LangyAgentUnavailableError);

    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  /** @scenario Langy reports the agent unavailable instead of hanging the turn */
  it("never dispatches a turn with a falsy runToken", async () => {
    const fixture = makeFixture({
      conversations: {
        ensureConversation: vi.fn(async () => ({ id: "conversation-1", isNew: false })),
        findByIdVisible: vi.fn(async () =>
          conversationDetail({ status: LANGY_CONVERSATION_STATUS.IDLE }),
        ),
        findPendingHandoff: vi.fn(async () => null),
        findRunToken: vi.fn(async (): Promise<string | null> => ""),
        acceptTurn: vi.fn(async () => ({ turnId: "turn-1" })),
        finalizeTurn: vi.fn(async () => ({ messageId: "message-1" })),
      },
    });

    await expect(
      LangyTurnService.create(fixture.deps).startConversationTurn(input),
    ).rejects.toBeInstanceOf(LangyAgentUnavailableError);

    expect(fixture.dispatch).not.toHaveBeenCalled();
  });
});
