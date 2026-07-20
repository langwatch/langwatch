import { beforeEach, describe, expect, it, vi } from "vitest";
import { LANGY_CONVERSATION_STATUS } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import {
  LangyModelNotAllowedError,
  LangyModelNotConfiguredError,
  LangyTurnInProgressError,
} from "../errors";
import {
  LangyTurnService,
  type LangyTurnServiceDeps,
  type StartConversationTurnInput,
} from "../langy-turn.service";
import type { LangyTurnAdmissionClaim } from "../repositories/langy-turn-admission.repository";

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const TURN_ID = `langyturn_request-${REQUEST_ID}`;
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
    getModelsAllowed: vi.fn(async () => null),
  };

  const deps = {
    conversations:
      conversations as unknown as LangyTurnServiceDeps["conversations"],
    credentials: credentials as unknown as LangyTurnServiceDeps["credentials"],
    resolveModel: vi.fn(async () => ({})),
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
    },
  };
}

const input = (
  over: Partial<StartConversationTurnInput> = {},
): StartConversationTurnInput => ({
  projectId: "p1",
  requestId: REQUEST_ID,
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
          messageId: `langymsg_request-${REQUEST_ID}`,
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

  it("does not resolve an unused default model when an override is allowed", async () => {
    (
      deps.credentials.getModelsAllowed as ReturnType<typeof vi.fn>
    ).mockResolvedValue(["openai/gpt-5-mini"]);

    await LangyTurnService.create(deps).startConversationTurn(
      input({ modelOverride: "openai/gpt-5-mini" }),
    );

    expect(deps.resolveModel).not.toHaveBeenCalled();
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
