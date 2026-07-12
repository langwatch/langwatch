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

const SESSION = { user: { id: "user-1" } } as StartConversationTurnInput["session"];

function makeDeps(over: Partial<LangyTurnServiceDeps> = {}): {
  deps: LangyTurnServiceDeps;
  mocks: {
    recordUserMessage: ReturnType<typeof vi.fn>;
    createConversation: ReturnType<typeof vi.fn>;
    startTurn: ReturnType<typeof vi.fn>;
    probe: ReturnType<typeof vi.fn>;
    mintSessionKey: ReturnType<typeof vi.fn>;
    reservePermit: ReturnType<typeof vi.fn>;
    releasePermit: ReturnType<typeof vi.fn>;
    grant: ReturnType<typeof vi.fn>;
    stash: ReturnType<typeof vi.fn>;
  };
} {
  const recordUserMessage = vi.fn(async () => ({ messageId: "m1" }));
  const createConversation = vi.fn(async ({ conversationId }: { conversationId: string }) => ({
    id: conversationId,
  }));
  const startTurn = vi.fn(async ({ turnId }: { turnId: string }) => ({ turnId }));
  const probe = vi.fn(async () => false);
  const mintSessionKey = vi.fn(async () => ({ token: "t", apiKeyId: "k" }));
  const reservePermit = vi.fn(async () => ({
    reserved: true,
    allowed: true,
    resetAt: 0,
  }));
  const releasePermit = vi.fn(async () => {});
  const grant = vi.fn(async () => {});
  const stash = vi.fn(async () => {});

  const conversations = {
    ensureConversation: vi.fn(async () => ({ id: "conv-1" })),
    recordUserMessage,
    findByIdVisible: vi.fn(async () => ({ status: LANGY_CONVERSATION_STATUS.IDLE })),
    getPendingHandoff: vi.fn(async () => null),
    startTurn,
    createConversation,
    consumeHandoff: vi.fn(async () => {}),
  };
  const credentials = {
    getOrProvision: vi.fn(async () => ({ organizationId: "org-1" })),
    getEgressAllowlist: vi.fn(async () => null),
    getModelsAllowed: vi.fn(async () => null),
  };

  const deps = {
    conversations: conversations as unknown as LangyTurnServiceDeps["conversations"],
    credentials: credentials as unknown as LangyTurnServiceDeps["credentials"],
    resolveModel: vi.fn(async () => ({})),
    worker: { probe, warm: vi.fn(async () => {}) },
    reservePermit,
    releasePermit,
    perDayPrCap: 5,
    mintSessionKey,
    accessStore: { grant } as unknown as LangyTurnServiceDeps["accessStore"],
    handoffStore: { stash } as unknown as LangyTurnServiceDeps["handoffStore"],
    ...over,
  } as LangyTurnServiceDeps;

  return {
    deps,
    mocks: {
      recordUserMessage,
      createConversation,
      startTurn,
      probe,
      mintSessionKey,
      reservePermit,
      releasePermit,
      grant,
      stash,
    },
  };
}

const input = (over: Partial<StartConversationTurnInput> = {}): StartConversationTurnInput => ({
  projectId: "p1",
  session: SESSION,
  requestedConversationId: null,
  messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
  isRetry: false,
  turnContext: { pageContext: undefined, skills: undefined } as StartConversationTurnInput["turnContext"],
  ...over,
});

describe("LangyTurnService.startConversationTurn", () => {
  let deps: LangyTurnServiceDeps;
  let mocks: ReturnType<typeof makeDeps>["mocks"];

  beforeEach(() => {
    ({ deps, mocks } = makeDeps());
  });

  describe("given a healthy fresh turn", () => {
    it("returns the conversation and turn ids and stashes the live-access grant + handoff", async () => {
      const svc = LangyTurnService.create(deps);
      const result = await svc.startConversationTurn(input());

      expect(result.conversationId).toBe("conv-1");
      expect(result.turnId).toEqual(expect.any(String));
      expect(mocks.grant).toHaveBeenCalledTimes(1);
      expect(mocks.stash).toHaveBeenCalledTimes(1);
      expect(mocks.startTurn).toHaveBeenCalledTimes(1);
    });

    it("threads the user's question parts onto the turn for the turn document", async () => {
      const svc = LangyTurnService.create(deps);
      await svc.startConversationTurn(input());
      expect(mocks.startTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          questionParts: [{ type: "text", text: "hi" }],
        }),
      );
    });

    it("records the user message before dispatching the turn", async () => {
      const order: string[] = [];
      mocks.recordUserMessage.mockImplementation(async () => {
        order.push("message");
        return { messageId: "m1" };
      });
      mocks.startTurn.mockImplementation(async ({ turnId }: { turnId: string }) => {
        order.push("turn");
        return { turnId };
      });
      const svc = LangyTurnService.create(deps);
      await svc.startConversationTurn(input());
      expect(order).toEqual(["message", "turn"]);
    });
  });

  describe("given a new conversation (create)", () => {
    it("emits conversation_started (the semantically-first marker) then dispatches the turn", async () => {
      const svc = LangyTurnService.create(deps);
      await svc.startConversationTurn(input({ isNewConversation: true }));
      expect(mocks.createConversation).toHaveBeenCalledTimes(1);
      expect(mocks.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: "conv-1" }),
      );
      expect(mocks.startTurn).toHaveBeenCalledTimes(1);
    });

    it("does not block the turn when the conversation_started marker fails", async () => {
      mocks.createConversation.mockRejectedValue(new Error("marker write failed"));
      const svc = LangyTurnService.create(deps);
      const result = await svc.startConversationTurn(input({ isNewConversation: true }));
      expect(result.turnId).toEqual(expect.any(String));
      expect(mocks.startTurn).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a continued conversation (default)", () => {
    it("does not emit conversation_started", async () => {
      const svc = LangyTurnService.create(deps);
      await svc.startConversationTurn(input());
      expect(mocks.createConversation).not.toHaveBeenCalled();
    });
  });

  describe("given a live worker (probe hit)", () => {
    it("does not mint a session key", async () => {
      mocks.probe.mockResolvedValue(true);
      const svc = LangyTurnService.create(deps);
      await svc.startConversationTurn(input());
      expect(mocks.mintSessionKey).not.toHaveBeenCalled();
    });
  });

  describe("given a cold worker (probe miss)", () => {
    it("mints a session key", async () => {
      mocks.probe.mockResolvedValue(false);
      const svc = LangyTurnService.create(deps);
      await svc.startConversationTurn(input());
      expect(mocks.mintSessionKey).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a turn already running for the conversation", () => {
    it("throws LangyTurnInProgressError and releases the reserved permit", async () => {
      (deps.conversations.findByIdVisible as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: LANGY_CONVERSATION_STATUS.RUNNING,
      });
      const svc = LangyTurnService.create(deps);
      await expect(svc.startConversationTurn(input())).rejects.toBeInstanceOf(
        LangyTurnInProgressError,
      );
      expect(mocks.releasePermit).toHaveBeenCalledTimes(1);
      expect(mocks.startTurn).not.toHaveBeenCalled();
    });
  });

  describe("given a modelOverride the project does not allow", () => {
    it("throws LangyModelNotAllowedError before reserving a PR permit", async () => {
      (deps.credentials.getModelsAllowed as ReturnType<typeof vi.fn>).mockResolvedValue([
        "openai/gpt-5-mini",
      ]);
      const svc = LangyTurnService.create(deps);
      await expect(
        svc.startConversationTurn(input({ modelOverride: "evil/model" })),
      ).rejects.toBeInstanceOf(LangyModelNotAllowedError);
      expect(mocks.reservePermit).not.toHaveBeenCalled();
    });
  });

  describe("given no model is configured", () => {
    it("throws LangyModelNotConfiguredError", async () => {
      (deps.resolveModel as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("no model"),
      );
      const svc = LangyTurnService.create(deps);
      await expect(svc.startConversationTurn(input())).rejects.toBeInstanceOf(
        LangyModelNotConfiguredError,
      );
    });
  });

  describe("given a retry", () => {
    it("does not re-record the user message", async () => {
      const svc = LangyTurnService.create(deps);
      await svc.startConversationTurn(input({ isRetry: true }));
      expect(mocks.recordUserMessage).not.toHaveBeenCalled();
      expect(mocks.startTurn).toHaveBeenCalledTimes(1);
    });
  });
});
