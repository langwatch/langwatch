import { LANGY_CONVERSATION_STATUS } from "@langwatch/langy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LangyConversationNotOwnedError,
  LangyModelNotAllowedError,
  LangyModelNotConfiguredError,
  LangyTurnInProgressError,
  LangyTurnNotStoppableError,
} from "../errors";
import {
  LangyTurnService,
  type LangyTurnServiceDeps,
  langyTurnIdentity,
  type StartConversationTurnInput,
} from "../langy-turn.service";
import type { LangyMessageRow } from "../repositories/langy-message.repository";
import type { LangyTurnAdmissionClaim } from "../repositories/langy-turn-admission.repository";

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const SESSION = {
  user: { id: "user-1" },
} as StartConversationTurnInput["session"];

function makeDeps(over: Partial<LangyTurnServiceDeps> = {}) {
  const recordUserMessage = vi.fn(async () => ({ messageId: "m1" }));
  const createConversation = vi.fn(
    async ({ conversationId }: { conversationId: string }) => ({
      id: conversationId,
    }),
  );
  const ensureConversation = vi.fn(async () => ({
    id: "conv-1",
    isNew: false,
  }));
  const acceptTurn = vi.fn(async ({ turnId }: { turnId: string }) => ({
    turnId,
  }));
  const probe = vi.fn(async (_args: { hasGithubAuth: boolean }) => false);
  const dispatch = vi.fn(async () => "accepted" as const);
  const mintSessionKey = vi.fn(async () => ({ token: "t", apiKeyId: "k" }));
  const revokeSessionKey = vi.fn(async () => {});
  const reservePermit = vi.fn(async () => ({
    reserved: true,
    allowed: true,
    resetAt: 0,
  }));
  const releasePermit = vi.fn(async () => {});
  const grant = vi.fn(async () => {});
  const stash = vi.fn(async () => {});
  const claim = vi.fn(
    async ({
      conversationId,
      turnId,
    }: {
      conversationId: string;
      turnId: string;
    }): Promise<LangyTurnAdmissionClaim> => ({
      kind: "claimed",
      claimToken: "claim-1",
      conversationId,
      turnId,
    }),
  );
  const commit = vi.fn(async () => {});
  const abort = vi.fn(async () => {});

  const conversations = {
    ensureConversation,
    recordUserMessage,
    findByIdVisible: vi.fn(async () => ({
      status: LANGY_CONVERSATION_STATUS.IDLE,
    })),
    getPendingHandoff: vi.fn(async () => null),
    getRunToken: vi.fn(async () => "rt-existing"),
    acceptTurn,
    createConversation,
    consumeHandoff: vi.fn(async () => {}),
  };
  const credentials = {
    getOrProvision: vi.fn(async () => ({ organizationId: "org-1" })),
    getEgressAllowlist: vi.fn(async () => null),
    resolveMirrorTier: vi.fn(async () => "content" as const),
    getModelsAllowed: vi.fn(async () => null),
  };

  const findAllByConversation = vi.fn(async () => [] as LangyMessageRow[]);

  const deps = {
    conversations:
      conversations as unknown as LangyTurnServiceDeps["conversations"],
    credentials: credentials as unknown as LangyTurnServiceDeps["credentials"],
    resolveModel: vi.fn(async () => ({ modelId: "openai/gpt-5-mini" })),
    worker: { probe, dispatch },
    reservePermit,
    releasePermit,
    perDayPrCap: 5,
    mintSessionKey,
    revokeSessionKey,
    admission: {
      claim,
      commit,
      abort,
      release: vi.fn(async () => {}),
    },
    accessStore: { grant } as unknown as LangyTurnServiceDeps["accessStore"],
    handoffStore: { stash } as unknown as LangyTurnServiceDeps["handoffStore"],
    messages: { findAllByConversation },
    ...over,
  } as LangyTurnServiceDeps;

  return {
    deps,
    mocks: {
      recordUserMessage,
      createConversation,
      ensureConversation,
      acceptTurn,
      probe,
      dispatch,
      mintSessionKey,
      revokeSessionKey,
      reservePermit,
      releasePermit,
      grant,
      stash,
      claim,
      commit,
      abort,
      findAllByConversation,
    },
  };
}

const IDENTITY = langyTurnIdentity({
  userId: "user-1",
  idempotencyKey: REQUEST_ID,
  messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
});
const TURN_ID = IDENTITY.turnId;

const input = (
  over: Partial<StartConversationTurnInput> = {},
): StartConversationTurnInput => ({
  projectId: "p1",
  idempotencyKey: REQUEST_ID,
  session: SESSION,
  requestedConversationId: null,
  messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
  isRetry: false,
  turnContext: {
    pageContext: undefined,
    skills: undefined,
  } as StartConversationTurnInput["turnContext"],
  ...over,
});

describe("LangyTurnService.startConversationTurn", () => {
  let deps: LangyTurnServiceDeps;
  let mocks: ReturnType<typeof makeDeps>["mocks"];

  beforeEach(() => {
    ({ deps, mocks } = makeDeps());
  });

  it("commits one atomic message + acceptance command and fast-dispatches it", async () => {
    const result = await LangyTurnService.create(deps).startConversationTurn(
      input(),
    );

    expect(result).toEqual({ conversationId: "conv-1", turnId: TURN_ID });
    expect(mocks.grant).toHaveBeenCalledOnce();
    expect(mocks.stash).toHaveBeenCalledWith(
      expect.objectContaining({ runToken: "rt-existing" }),
    );
    expect(mocks.recordUserMessage).not.toHaveBeenCalled();
    expect(mocks.createConversation).not.toHaveBeenCalled();
    expect(mocks.acceptTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        questionParts: [{ type: "text", text: "hi" }],
        userMessage: expect.objectContaining({
          messageId: IDENTITY.messageId,
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        }),
      }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        userId: "user-1",
        conversationId: "conv-1",
        turnId: TURN_ID,
      }),
    );
  });

  it("atomically prefixes a new conversation with its owner and run token", async () => {
    mocks.ensureConversation.mockResolvedValue({ id: "conv-1", isNew: true });

    await LangyTurnService.create(deps).startConversationTurn(input());

    expect(mocks.acceptTurn).toHaveBeenCalledWith(
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
    await LangyTurnService.create(deps).startConversationTurn(
      input({ isRetry: true }),
    );

    expect(mocks.acceptTurn).toHaveBeenCalledWith(
      expect.not.objectContaining({ userMessage: expect.anything() }),
    );
  });

  it("replays the original ids without minting or dispatching a second time", async () => {
    mocks.claim
      .mockResolvedValueOnce({
        kind: "claimed",
        claimToken: "claim-1",
        conversationId: "conv-1",
        turnId: TURN_ID,
      })
      .mockResolvedValueOnce({
        kind: "replay",
        conversationId: "conv-1",
        turnId: TURN_ID,
      });
    const service = LangyTurnService.create(deps);

    await service.startConversationTurn(input());
    const replay = await service.startConversationTurn(input());

    expect(replay).toEqual({ conversationId: "conv-1", turnId: TURN_ID });
    expect(mocks.mintSessionKey).toHaveBeenCalledOnce();
    expect(mocks.acceptTurn).toHaveBeenCalledOnce();
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it("does not mint when the principal-bound worker probe hits", async () => {
    mocks.probe.mockResolvedValue(true);

    await LangyTurnService.create(deps).startConversationTurn(input());

    expect(mocks.mintSessionKey).not.toHaveBeenCalled();
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "continue" }),
    );
  });

  it("finalizes the GitHub permit before probing the worker signature", async () => {
    const order: string[] = [];
    (
      deps.credentials.getOrProvision as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      organizationId: "org-1",
      githubToken: "gh-token",
      githubLogin: "octocat",
    });
    mocks.reservePermit.mockImplementation(async () => {
      order.push("permit");
      return {
        reserved: false,
        allowed: false,
        resetAt: Date.now() + 60_000,
      };
    });
    mocks.probe.mockImplementation(async ({ hasGithubAuth }) => {
      order.push(`probe:${String(hasGithubAuth)}`);
      return false;
    });

    await LangyTurnService.create(deps).startConversationTurn(input());

    expect(order).toEqual(["permit", "probe:false"]);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.not.objectContaining({
          githubToken: expect.anything(),
        }),
      }),
    );
  });

  it("rejects an authoritative busy admission before probing or minting", async () => {
    mocks.claim.mockResolvedValue({ kind: "busy" });

    await expect(
      LangyTurnService.create(deps).startConversationTurn(input()),
    ).rejects.toBeInstanceOf(LangyTurnInProgressError);

    expect(mocks.probe).not.toHaveBeenCalled();
    expect(mocks.mintSessionKey).not.toHaveBeenCalled();
    expect(mocks.acceptTurn).not.toHaveBeenCalled();
  });

  it("keeps the projection guard only as rollout defence and aborts its claim", async () => {
    (
      deps.conversations.findByIdVisible as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ status: LANGY_CONVERSATION_STATUS.RUNNING });

    await expect(
      LangyTurnService.create(deps).startConversationTurn(input()),
    ).rejects.toBeInstanceOf(LangyTurnInProgressError);

    expect(mocks.abort).toHaveBeenCalledOnce();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("rejects a disallowed model and releases the admission", async () => {
    (
      deps.credentials.getModelsAllowed as ReturnType<typeof vi.fn>
    ).mockResolvedValue(["openai/gpt-5-mini"]);

    await expect(
      LangyTurnService.create(deps).startConversationTurn(
        input({ modelOverride: "evil/model" }),
      ),
    ).rejects.toBeInstanceOf(LangyModelNotAllowedError);

    expect(mocks.abort).toHaveBeenCalledOnce();
    expect(mocks.reservePermit).not.toHaveBeenCalled();
  });

  // The engine is provider-blind: any model on the project's Langy allowlist
  // is dispatched with its full provider-prefixed id — dots, colons, and all
  // — and the gateway's own prefix routing picks the provider. Nothing here
  // may branch per provider name.
  /** @scenario Any allowed provider's model is dispatched with its full id */
  it.each([
    "anthropic/claude-sonnet-4-5",
    "gemini/gemini-2.5-pro",
    "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0",
  ])("accepts and forwards the allowed model %s verbatim", async (model) => {
    (
      deps.credentials.getModelsAllowed as ReturnType<typeof vi.fn>
    ).mockResolvedValue([model]);

    const result = await LangyTurnService.create(deps).startConversationTurn(
      input({ modelOverride: model }),
    );

    expect(result.conversationId).toBe("conv-1");
    expect(mocks.probe).toHaveBeenCalledWith(
      expect.objectContaining({ model }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ modelOverride: model }),
    );
  });

  /** @scenario A per-send override still wins over the configured Langy model */
  it("does not resolve an unused default model when an override is allowed", async () => {
    (
      deps.credentials.getModelsAllowed as ReturnType<typeof vi.fn>
    ).mockResolvedValue(["openai/gpt-5-mini"]);

    await LangyTurnService.create(deps).startConversationTurn(
      input({ modelOverride: "openai/gpt-5-mini" }),
    );

    expect(deps.resolveModel).not.toHaveBeenCalled();
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ modelOverride: "openai/gpt-5-mini" }),
    );
  });

  /** @scenario The configured Langy model is forwarded to the worker */
  it("forwards the resolved default model to the worker when nothing overrides it", async () => {
    (deps.resolveModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      modelId: "anthropic/claude-opus-4-8",
    });

    await LangyTurnService.create(deps).startConversationTurn(input());

    // Probe, handoff stash, and dispatch all carry the resolved model, so the
    // worker signature keys on it and the worker never runs its own default.
    expect(mocks.probe).toHaveBeenCalledWith(
      expect.objectContaining({ model: "anthropic/claude-opus-4-8" }),
    );
    expect(mocks.stash).toHaveBeenCalledWith(
      expect.objectContaining({ modelOverride: "anthropic/claude-opus-4-8" }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ modelOverride: "anthropic/claude-opus-4-8" }),
    );
  });

  it("rejects a resolved default that is not on the allowlist before dispatch", async () => {
    (deps.resolveModel as ReturnType<typeof vi.fn>).mockResolvedValue({
      modelId: "anthropic/claude-opus-4-8",
    });
    (
      deps.credentials.getModelsAllowed as ReturnType<typeof vi.fn>
    ).mockResolvedValue(["openai/gpt-5-mini"]);

    await expect(
      LangyTurnService.create(deps).startConversationTurn(input()),
    ).rejects.toBeInstanceOf(LangyModelNotAllowedError);

    expect(mocks.abort).toHaveBeenCalledOnce();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("fails before admission when no default model is configured", async () => {
    (deps.resolveModel as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("no model"),
    );

    await expect(
      LangyTurnService.create(deps).startConversationTurn(input()),
    ).rejects.toBeInstanceOf(LangyModelNotConfiguredError);

    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("revokes the key, releases the permit, and aborts when acceptance fails", async () => {
    (
      deps.credentials.getOrProvision as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ organizationId: "org-1", githubToken: "gh-token" });
    mocks.acceptTurn.mockRejectedValue(new Error("event store failed"));

    await expect(
      LangyTurnService.create(deps).startConversationTurn(input()),
    ).rejects.toThrow();

    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.revokeSessionKey).toHaveBeenCalledWith({
      apiKeyId: "k",
      projectId: "p1",
    });
    expect(mocks.releasePermit).toHaveBeenCalledWith({ userId: "user-1" });
    expect(mocks.abort).toHaveBeenCalledOnce();
  });

  it("does not fast-dispatch until the durable replay receipt commits", async () => {
    let resolveCommit!: () => void;
    mocks.commit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCommit = resolve;
        }),
    );

    const result = LangyTurnService.create(deps).startConversationTurn(input());
    await vi.waitFor(() => expect(mocks.commit).toHaveBeenCalledOnce());
    expect(mocks.dispatch).not.toHaveBeenCalled();
    resolveCommit();
    await result;
    expect(mocks.dispatch).toHaveBeenCalledOnce();
  });

  it("leaves eager dispatch to the outbox when receipt commit is unconfirmed", async () => {
    mocks.commit.mockRejectedValue(new Error("postgres unavailable"));

    await expect(
      LangyTurnService.create(deps).startConversationTurn(input()),
    ).resolves.toEqual({ conversationId: "conv-1", turnId: TURN_ID });

    expect(mocks.acceptTurn).toHaveBeenCalledOnce();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("consumes a pending handoff in the same acceptance command", async () => {
    (
      deps.conversations.getPendingHandoff as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ turnId: "old-turn", token: "checkpoint" });

    await LangyTurnService.create(deps).startConversationTurn(input());

    expect(mocks.acceptTurn).toHaveBeenCalledWith(
      expect.objectContaining({ consumeHandoffTurnId: "old-turn" }),
    );
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "revive", resumeToken: "checkpoint" }),
    );
  });
});

/**
 * THE "run it" BUG. The agent's memory of a conversation lives only inside its
 * live worker process, and that process is reaped after ten idle minutes,
 * killed when the turn's capabilities change, and gone whenever the fleet rolls.
 * The control plane used to send a turn nothing but the latest user sentence, so
 * after any of those events "run it" arrived with no "it" in sight — and the
 * agent filled the hole with a trace search.
 *
 * These pin the plumbing: the conversation's own history reaches the system
 * block, whatever the worker does or does not remember.
 */
describe("when a follow-up turn depends on what an earlier turn created", () => {
  /** The tool part a scenario create leaves on the durable assistant message. */
  const scenarioCreated: LangyMessageRow = {
    id: "m1",
    role: "assistant",
    parts: [
      {
        type: "tool-langwatch.scenario.create",
        toolCallId: "call-1",
        state: "output-available",
        digest: {
          resource: "scenario",
          verb: "create",
          strategy: "id-ref",
          primaryId: "scenario_0002E069Y90C5aaw1h325gUZ7TE0W",
          ids: ["scenario_0002E069Y90C5aaw1h325gUZ7TE0W"],
          name: "Customer support agent",
        },
      },
      { type: "text", text: "", role: "assistant" },
    ] as LangyMessageRow["parts"],
    createdAt: new Date(),
  };

  const systemOf = (dispatch: ReturnType<typeof vi.fn>): string =>
    (dispatch.mock.calls[0]![0] as { system: string }).system;

  /** @scenario A follow-up turn carries what earlier turns created */
  /** @scenario The memory survives the agent forgetting */
  it("hands the agent the id its own earlier turn produced", async () => {
    const { deps, mocks } = makeDeps();
    mocks.findAllByConversation.mockResolvedValue([scenarioCreated]);
    // A warm worker would still hold the session — the point is that this does
    // not depend on it.
    mocks.probe.mockResolvedValue(true);

    await LangyTurnService.create(deps).startConversationTurn(
      input({
        messages: [{ role: "user", parts: [{ type: "text", text: "run it" }] }],
      }),
    );

    const system = systemOf(mocks.dispatch);
    expect(system).toContain("scenario_0002E069Y90C5aaw1h325gUZ7TE0W");
    expect(system).toContain("Customer support agent");
    expect(mocks.findAllByConversation).toHaveBeenCalledWith({
      conversationId: "conv-1",
      projectId: "p1",
    });
  });

  /** @scenario Every turn carries the rule for resolving a bare reference */
  /** @scenario The rule is read after everything it talks about */
  it("carries the rule for resolving a bare reference, after the things it resolves against", async () => {
    const { deps, mocks } = makeDeps();
    mocks.findAllByConversation.mockResolvedValue([scenarioCreated]);

    await LangyTurnService.create(deps).startConversationTurn(
      input({
        turnContext: {
          pageContext: [
            { kind: "trace", ref: "trace-abc", label: "trace abc" },
          ],
        },
      }),
    );

    const system = systemOf(mocks.dispatch);
    expect(system).toContain("RESOLVING WHAT THE USER MEANS");
    // The policy says "described above", so both data blocks must precede it.
    expect(
      system.indexOf("WHAT THIS CONVERSATION HAS ALREADY DONE"),
    ).toBeLessThan(system.indexOf("RESOLVING WHAT THE USER MEANS"));
    expect(system.indexOf("WHAT THE USER IS LOOKING AT")).toBeLessThan(
      system.indexOf("RESOLVING WHAT THE USER MEANS"),
    );
  });

  /** @scenario A follow-up turn carries the conversation so far */
  /** @scenario What was said survives the worker being replaced */
  /** @scenario Switching models mid-conversation keeps the conversation */
  it("carries the transcript so a fresh worker on another model continues the conversation", async () => {
    const { deps, mocks } = makeDeps();
    mocks.findAllByConversation.mockResolvedValue([
      {
        id: "t1",
        role: "user",
        parts: [
          { type: "text", text: "my name is rogerio" },
        ] as LangyMessageRow["parts"],
        createdAt: new Date(),
      },
      {
        id: "t2",
        role: "assistant",
        parts: [
          { type: "text", text: "Nice to meet you, Rogerio!" },
        ] as LangyMessageRow["parts"],
        createdAt: new Date(),
      },
    ]);
    // The model switch recycled the worker: the probe misses and this turn
    // will run on a fresh session that has never seen the conversation.
    mocks.probe.mockResolvedValue(false);

    await LangyTurnService.create(deps).startConversationTurn(
      input({
        modelOverride: "anthropic/claude-haiku-4-5",
        messages: [
          { role: "user", parts: [{ type: "text", text: "what is my name?" }] },
        ],
      }),
    );

    const system = systemOf(mocks.dispatch);
    expect(system).toContain("THE CONVERSATION SO FAR");
    expect(system).toContain("User: my name is rogerio");
    expect(system).toContain("Langy: Nice to meet you, Rogerio!");
    // The transcript precedes the referent policy, so "described above" is true.
    expect(system.indexOf("THE CONVERSATION SO FAR")).toBeLessThan(
      system.indexOf("RESOLVING WHAT THE USER MEANS"),
    );
    // The stash carries the same seeded system: an outbox or liveness
    // re-dispatch to a fresh worker continues the conversation too.
    const stashed = (
      mocks.stash.mock.calls[0] as unknown as [{ system: string }]
    )[0];
    expect(stashed.system).toBe(system);
  });

  /** @scenario A brand-new conversation carries no memory */
  it("does not go looking for a history a fresh conversation cannot have", async () => {
    const { deps, mocks } = makeDeps();
    mocks.ensureConversation.mockResolvedValue({ id: "conv-1", isNew: true });

    await LangyTurnService.create(deps).startConversationTurn(input());

    expect(mocks.findAllByConversation).not.toHaveBeenCalled();
    expect(systemOf(mocks.dispatch)).not.toContain(
      "WHAT THIS CONVERSATION HAS ALREADY DONE",
    );
  });

  /** @scenario A conversation whose record cannot be read still answers */
  it("still runs the turn when the durable record cannot be read", async () => {
    const { deps, mocks } = makeDeps();
    mocks.findAllByConversation.mockRejectedValue(new Error("projection down"));

    const result = await LangyTurnService.create(deps).startConversationTurn(
      input(),
    );

    expect(result).toMatchObject({ conversationId: "conv-1" });
    expect(mocks.dispatch).toHaveBeenCalledOnce();
    expect(systemOf(mocks.dispatch)).not.toContain(
      "WHAT THIS CONVERSATION HAS ALREADY DONE",
    );
  });
});

describe("langyTurnIdentity", () => {
  const base = {
    userId: "user-1",
    idempotencyKey: "key-1",
    messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
  };

  it("derives the same identity for a byte-identical retry", () => {
    expect(langyTurnIdentity(base)).toEqual(langyTurnIdentity({ ...base }));
  });

  it("derives a different identity when the content changes under the same key", () => {
    const other = langyTurnIdentity({
      ...base,
      messages: [{ role: "user", parts: [{ type: "text", text: "bye" }] }],
    });
    expect(other.turnId).not.toBe(langyTurnIdentity(base).turnId);
  });

  it("derives a different identity for another user with the same key and content", () => {
    const other = langyTurnIdentity({ ...base, userId: "user-2" });
    expect(other.turnId).not.toBe(langyTurnIdentity(base).turnId);
  });

  it("treats a model override change as different content", () => {
    const other = langyTurnIdentity({
      ...base,
      modelOverride: "openai/gpt-5-mini",
    });
    expect(other.turnId).not.toBe(langyTurnIdentity(base).turnId);
  });
});

describe("when the idempotency key is reused with different content", () => {
  it("rejects with the mismatch error instead of replaying the original send", async () => {
    const { deps } = makeDeps({
      admission: {
        claim: vi.fn(
          async () => ({ kind: "mismatch" }) as LangyTurnAdmissionClaim,
        ),
        commit: vi.fn(async () => {}),
        abort: vi.fn(async () => {}),
        release: vi.fn(async () => {}),
      } as unknown as LangyTurnServiceDeps["admission"],
    });
    const service = LangyTurnService.create(deps);

    await expect(service.startConversationTurn(input())).rejects.toMatchObject({
      code: "langy_idempotency_mismatch",
    });
  });
});

describe("when the send carries no usable text", () => {
  it("rejects before admitting anything durable", async () => {
    const { deps, mocks } = makeDeps();
    const service = LangyTurnService.create(deps);

    await expect(
      service.startConversationTurn(
        input({ messages: [{ role: "user", parts: [] }] }),
      ),
    ).rejects.toMatchObject({ code: "langy_empty_message" });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});

describe("LangyTurnService.stopTurn", () => {
  function makeStopDeps(
    over: {
      isTurnActor?: boolean;
      isOwn?: boolean;
      currentTurnId?: string | null;
      deltas?: string[];
      cancelRejects?: boolean;
      noBuffer?: boolean;
    } = {},
  ) {
    // Declared with its argument even though the body ignores it: a zero-arg
    // `vi.fn` types `mock.calls` as an empty tuple, so reading `calls[0][0]` —
    // which is the whole point of the assertions below — cannot typecheck.
    const finalizeTurn = vi.fn(async (_args: Record<string, unknown>) => ({
      messageId: "a1",
    }));
    const findByIdVisible = vi.fn(async () => ({
      isOwn: over.isOwn ?? true,
      currentTurnId:
        over.currentTurnId === undefined ? "turn-1" : over.currentTurnId,
    }));
    const isTurnActor = vi.fn(async () => over.isTurnActor ?? true);
    const markEnd = vi.fn(async () => {});
    const cancel = vi.fn(async () => {
      if (over.cancelRejects) throw new Error("worker unreachable");
    });
    const readTail = vi.fn(async () => ({
      reads: (over.deltas ?? ["half ", "an answer"]).map((text, i) => ({
        id: `${i}`,
        entry: { type: "delta" as const, text },
      })),
      lastId: "9",
    }));
    const deps = {
      conversations: {
        finalizeTurn,
        findByIdVisible,
      } as unknown as LangyTurnServiceDeps["conversations"],
      credentials: {} as unknown as LangyTurnServiceDeps["credentials"],
      resolveModel: vi.fn(),
      worker: { cancel } as unknown as LangyTurnServiceDeps["worker"],
      tokenBuffer: over.noBuffer
        ? null
        : ({
            readTail,
            markEnd,
          } as unknown as LangyTurnServiceDeps["tokenBuffer"]),
      reservePermit: vi.fn(),
      releasePermit: vi.fn(),
      perDayPrCap: 0,
      mintSessionKey: vi.fn(),
      revokeSessionKey: vi.fn(),
      admission: {} as unknown as LangyTurnServiceDeps["admission"],
      accessStore: {
        isTurnActor,
      } as unknown as LangyTurnServiceDeps["accessStore"],
      handoffStore: null,
      // A stop reads no history — it finalizes a turn already in flight.
      messages: null,
    } as LangyTurnServiceDeps;
    return {
      deps,
      mocks: {
        finalizeTurn,
        findByIdVisible,
        isTurnActor,
        markEnd,
        cancel,
        readTail,
      },
    };
  }

  const stopArgs = {
    projectId: "p1",
    conversationId: "conv-1",
    turnId: "turn-1",
    userId: "user-1",
  };

  describe("given the caller is the turn's actor", () => {
    /** @scenario Stopping a turn ends it on the backend, not just in my browser */
    /** @scenario Stopping asks the worker to abandon the running generation */
    it("records a stopped terminal carrying the partial answer, ends the stream, and asks the worker to cancel", async () => {
      const { deps, mocks } = makeStopDeps({ isTurnActor: true });

      await LangyTurnService.create(deps).stopTurn(stopArgs);

      expect(mocks.finalizeTurn).toHaveBeenCalledTimes(1);
      const call = mocks.finalizeTurn.mock.calls[0]![0] as {
        outcome: string;
        parts: Array<{ text?: string }>;
      };
      expect(call.outcome).toBe("stopped");
      // The partial answer is the joined durable delta tail, preserved verbatim.
      expect(call.parts.map((p) => p.text ?? "").join("")).toBe(
        "half an answer",
      );
      expect(mocks.markEnd).toHaveBeenCalledTimes(1);
      expect(mocks.cancel).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: "conv-1", turnId: "turn-1" }),
      );
      // The actor short-circuits the ownership read.
      expect(mocks.findByIdVisible).not.toHaveBeenCalled();
    });
  });

  describe("given the caller is neither the actor nor the owner", () => {
    /** @scenario Only someone who can control the conversation may stop its turn */
    it("refuses with a handled not-owned error and records no terminal", async () => {
      const { deps, mocks } = makeStopDeps({
        isTurnActor: false,
        isOwn: false,
      });

      await expect(
        LangyTurnService.create(deps).stopTurn(stopArgs),
      ).rejects.toBeInstanceOf(LangyConversationNotOwnedError);
      expect(mocks.finalizeTurn).not.toHaveBeenCalled();
      expect(mocks.cancel).not.toHaveBeenCalled();
      expect(mocks.markEnd).not.toHaveBeenCalled();
    });
  });

  describe("given the caller owns the conversation but did not start the turn", () => {
    it("allows the stop when they name the turn the record has in flight", async () => {
      const { deps, mocks } = makeStopDeps({
        isTurnActor: false,
        isOwn: true,
        currentTurnId: "turn-1",
      });

      await LangyTurnService.create(deps).stopTurn(stopArgs);

      expect(mocks.finalizeTurn).toHaveBeenCalledTimes(1);
    });

    describe("when the named turn is not the one in flight", () => {
      /** @scenario A stop naming a turn that is not the one in flight is refused */
      it("refuses instead of writing a durable terminal for an unproven turn id", async () => {
        const { deps, mocks } = makeStopDeps({
          isTurnActor: false,
          isOwn: true,
          currentTurnId: "some-other-turn",
        });

        await expect(
          LangyTurnService.create(deps).stopTurn(stopArgs),
        ).rejects.toBeInstanceOf(LangyTurnNotStoppableError);
        expect(mocks.finalizeTurn).not.toHaveBeenCalled();
        expect(mocks.markEnd).not.toHaveBeenCalled();
        expect(mocks.cancel).not.toHaveBeenCalled();
      });

      it("refuses when the conversation has no turn in flight at all", async () => {
        const { deps, mocks } = makeStopDeps({
          isTurnActor: false,
          isOwn: true,
          currentTurnId: null,
        });

        await expect(
          LangyTurnService.create(deps).stopTurn(stopArgs),
        ).rejects.toBeInstanceOf(LangyTurnNotStoppableError);
        expect(mocks.finalizeTurn).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the caller IS the turn's actor", () => {
    it("stops without consulting the record — the live-access grant already proved the turn", async () => {
      const { deps, mocks } = makeStopDeps({
        isTurnActor: true,
        currentTurnId: null,
      });

      await LangyTurnService.create(deps).stopTurn(stopArgs);

      expect(mocks.findByIdVisible).not.toHaveBeenCalled();
      expect(mocks.finalizeTurn).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the worker cancel fails", () => {
    it("still records the stop — the durable terminal is what makes it truthful", async () => {
      const { deps, mocks } = makeStopDeps({ cancelRejects: true });

      await expect(
        LangyTurnService.create(deps).stopTurn(stopArgs),
      ).resolves.toBeUndefined();
      expect(mocks.finalizeTurn).toHaveBeenCalledTimes(1);
      expect(mocks.markEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe("when there is no live buffer to read a partial from", () => {
    it("still records a stopped terminal, with an empty answer", async () => {
      const { deps, mocks } = makeStopDeps({ noBuffer: true });

      await LangyTurnService.create(deps).stopTurn(stopArgs);

      expect(mocks.finalizeTurn).toHaveBeenCalledTimes(1);
      expect(mocks.finalizeTurn.mock.calls[0]![0]).toMatchObject({
        outcome: "stopped",
      });
    });
  });
});
