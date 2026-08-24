/**
 * The panel-open pre-warm (specs/langy/langy-worker-prewarm.feature): the warm
 * resolves the same credential surface a turn would, probes, mints a session
 * key only on a probe miss, and never lets a failure reach the caller. These
 * bind the warm service's own decisions, the worker port, credential service
 * and key mint are fakes.
 */
import { describe, expect, it, vi } from "vitest";
import {
  LangyConversationIdUnadoptableError,
  LangyModelNotConfiguredError,
} from "@langwatch/langy-contract";
import {
  LangyTurnService,
  type LangyTurnServiceDeps,
  type StartConversationTurnInput,
} from "../langy-turn.service";
import { LangySessionKeyScopeError } from "../langyApiKey";
import type { LangyWorkerPort } from "../langyWorker";

const SESSION = {
  user: { id: "user-1" },
} as StartConversationTurnInput["session"];

function makeDeps(over: Partial<LangyTurnServiceDeps> = {}) {
  const ensureConversation = vi.fn(async () => ({
    id: "conv-warm",
    isNew: true,
  }));
  const probe = vi.fn<LangyWorkerPort["probe"]>(async () => false);
  const warm = vi.fn<LangyWorkerPort["warm"]>(async () => {});
  const dispatch = vi.fn<LangyWorkerPort["dispatch"]>(async () => "accepted");
  const cancel = vi.fn<LangyWorkerPort["cancel"]>(async () => {});
  const mintSessionKey = vi.fn(async () => ({
    token: "sk-lw-warm",
    apiKeyId: "key-warm",
  }));
  const checkPermit = vi.fn(async () => ({ allowed: true }));
  const getOrProvision = vi.fn(
    async (): Promise<Record<string, unknown>> => ({
      organizationId: "org-1",
      llmVirtualKey: "vk",
      langwatchEndpoint: "http://lw",
      gatewayBaseUrl: "http://gw",
    }),
  );
  const getModelsAllowed = vi.fn(async (): Promise<string[] | null> => null);

  const conversations = {
    ensureConversation,
  } as unknown as LangyTurnServiceDeps["conversations"];
  const credentials = {
    getOrProvision,
    getEgressAllowlist: vi.fn(async () => null),
    resolveMirrorTier: vi.fn(async () => "content" as const),
    getModelsAllowed,
  } as unknown as LangyTurnServiceDeps["credentials"];

  const deps = {
    conversations,
    credentials,
    resolveModel: vi.fn(async () => ({ modelId: "openai/gpt-5-mini" })),
    worker: { probe, warm, dispatch, cancel },
    tokenBuffer: null,
    reservePermit: vi.fn(async () => ({
      reserved: false,
      allowed: true,
      resetAt: 0,
    })),
    releasePermit: vi.fn(async () => {}),
    checkPermit,
    perDayPrCap: 5,
    mintSessionKey,
    revokeSessionKey: vi.fn(async () => {}),
    admission: {} as LangyTurnServiceDeps["admission"],
    accessStore: null,
    handoffStore: null,
    messages: null,
    ...over,
  } as LangyTurnServiceDeps;

  return {
    deps,
    mocks: {
      ensureConversation,
      probe,
      warm,
      dispatch,
      mintSessionKey,
      checkPermit,
      getOrProvision,
      getModelsAllowed,
    },
  };
}

function warmInput(over: Record<string, unknown> = {}) {
  return {
    projectId: "proj-1",
    session: SESSION,
    requestedConversationId: null,
    ...over,
  } as Parameters<LangyTurnService["warmConversationWorker"]>[0];
}

describe("LangyTurnService.warmConversationWorker", () => {
  describe("given no worker is running for the conversation", () => {
    /** @scenario A warm with no live worker mints a key and spawns */
    it("mints a session key exactly once and warms the manager with it", async () => {
      const { deps, mocks } = makeDeps();
      const service = LangyTurnService.create(deps);

      const result = await service.warmConversationWorker(warmInput());

      expect(result).toEqual({ conversationId: "conv-warm", warmed: true });
      expect(mocks.mintSessionKey).toHaveBeenCalledTimes(1);
      expect(mocks.warm).toHaveBeenCalledTimes(1);
      const warmArgs = mocks.warm.mock.calls[0]![0] as {
        conversationId: string;
        modelOverride?: string;
        credentials: { langwatchApiKey?: string };
      };
      expect(warmArgs.conversationId).toBe("conv-warm");
      expect(warmArgs.modelOverride).toBe("openai/gpt-5-mini");
      expect(warmArgs.credentials.langwatchApiKey).toBe("sk-lw-warm");
    });

    /** @scenario A warm for a fresh chat returns a server-minted conversation id */
    it("returns the id ensureConversation minted for the fresh chat", async () => {
      const { deps, mocks } = makeDeps();
      const service = LangyTurnService.create(deps);

      const result = await service.warmConversationWorker(warmInput());

      expect(mocks.ensureConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "proj-1",
          userId: "user-1",
          conversationId: null,
        }),
      );
      expect(result.conversationId).toBe("conv-warm");
    });

    /** @scenario The warm hands the manager what revocation needs */
    it("rides the minted key id in the warm credentials so worker death can revoke it", async () => {
      const { deps, mocks } = makeDeps();
      const service = LangyTurnService.create(deps);

      await service.warmConversationWorker(warmInput());

      const warmArgs = mocks.warm.mock.calls[0]![0] as {
        credentials: { langwatchApiKeyId?: string };
      };
      expect(warmArgs.credentials.langwatchApiKeyId).toBe("key-warm");
    });
  });

  describe("given a matching worker is already live", () => {
    /** @scenario A warm that finds a live matching worker mints nothing */
    it("mints no key and dispatches no warm", async () => {
      const { deps, mocks } = makeDeps();
      mocks.probe.mockResolvedValue(true);
      const service = LangyTurnService.create(deps);

      const result = await service.warmConversationWorker(warmInput());

      expect(result).toEqual({ conversationId: "conv-warm", warmed: true });
      expect(mocks.mintSessionKey).not.toHaveBeenCalled();
      expect(mocks.warm).not.toHaveBeenCalled();
    });
  });

  describe("given the user has reached the daily GitHub PR cap", () => {
    /** @scenario The warm carries the same GitHub capability the turn would */
    it("probes and warms without the GitHub token, without spending a permit", async () => {
      const { deps, mocks } = makeDeps();
      mocks.getOrProvision.mockResolvedValue({
        organizationId: "org-1",
        llmVirtualKey: "vk",
        langwatchEndpoint: "http://lw",
        gatewayBaseUrl: "http://gw",
        githubToken: "gh-token",
        githubLogin: "octo",
      });
      mocks.checkPermit.mockResolvedValue({ allowed: false });
      const service = LangyTurnService.create(deps);

      await service.warmConversationWorker(warmInput());

      // Check-only: the permit view, never the reserving one.
      expect(deps.reservePermit).not.toHaveBeenCalled();
      const probeArgs = mocks.probe.mock.calls[0]![0] as unknown as {
        hasGithubAuth: boolean;
      };
      expect(probeArgs.hasGithubAuth).toBe(false);
      const warmArgs = mocks.warm.mock.calls[0]![0] as {
        credentials: { githubToken?: string; githubLogin?: string };
      };
      expect(warmArgs.credentials.githubToken).toBeUndefined();
      expect(warmArgs.credentials.githubLogin).toBeUndefined();
    });

    it("keeps the token when the cap is not reached", async () => {
      const { deps, mocks } = makeDeps();
      mocks.getOrProvision.mockResolvedValue({
        organizationId: "org-1",
        llmVirtualKey: "vk",
        langwatchEndpoint: "http://lw",
        gatewayBaseUrl: "http://gw",
        githubToken: "gh-token",
      });
      const service = LangyTurnService.create(deps);

      await service.warmConversationWorker(warmInput());

      const probeArgs = mocks.probe.mock.calls[0]![0] as unknown as {
        hasGithubAuth: boolean;
      };
      expect(probeArgs.hasGithubAuth).toBe(true);
    });
  });

  describe("given the harness flag resolves to pi", () => {
    it("rides the harness on the probe and inside the warm credentials", async () => {
      const { deps, mocks } = makeDeps({
        resolveHarness: vi.fn(async () => "pi" as const),
      });
      const service = LangyTurnService.create(deps);

      await service.warmConversationWorker(warmInput());

      const probeArgs = mocks.probe.mock.calls[0]![0] as unknown as {
        harness?: string;
      };
      expect(probeArgs.harness).toBe("pi");
      const warmArgs = mocks.warm.mock.calls[0]![0] as {
        credentials: { harness?: string };
      };
      expect(warmArgs.credentials.harness).toBe("pi");
    });
  });

  describe("given minting refuses because no Langy scope applies", () => {
    /** @scenario A user whose role cannot carry Langy scope sees nothing */
    it("swallows the scope refusal and reports it warmed nothing", async () => {
      const { deps, mocks } = makeDeps();
      mocks.mintSessionKey.mockRejectedValue(
        new LangySessionKeyScopeError("no scope"),
      );
      const service = LangyTurnService.create(deps);

      const result = await service.warmConversationWorker(warmInput());

      expect(result).toEqual({ conversationId: "conv-warm", warmed: false });
      expect(mocks.warm).not.toHaveBeenCalled();
    });
  });

  describe("given the credential surface cannot be resolved", () => {
    /** @scenario A warm that fails outright degrades to a cold start */
    it("returns warmed nothing instead of throwing", async () => {
      const { deps, mocks } = makeDeps();
      mocks.getOrProvision.mockRejectedValue(new Error("provision down"));
      const service = LangyTurnService.create(deps);

      const result = await service.warmConversationWorker(warmInput());

      expect(result).toEqual({ conversationId: null, warmed: false });
      expect(mocks.mintSessionKey).not.toHaveBeenCalled();
      expect(mocks.warm).not.toHaveBeenCalled();
    });

    it("skips the warm when no model is configured", async () => {
      const { deps, mocks } = makeDeps({
        resolveModel: vi.fn(async () => {
          throw new LangyModelNotConfiguredError();
        }),
      });
      const service = LangyTurnService.create(deps);

      const result = await service.warmConversationWorker(warmInput());

      expect(result.warmed).toBe(false);
      expect(mocks.warm).not.toHaveBeenCalled();
    });
  });

  describe("given a conversation id that cannot be adopted", () => {
    /** @scenario A conversation id that cannot be adopted never warms */
    it("warms nothing and reports no failure", async () => {
      const { deps, mocks } = makeDeps();
      mocks.ensureConversation.mockRejectedValue(
        new LangyConversationIdUnadoptableError("bad id!", "invalid_shape"),
      );
      const service = LangyTurnService.create(deps);

      const result = await service.warmConversationWorker(
        warmInput({ requestedConversationId: "bad id!" }),
      );

      expect(result).toEqual({ conversationId: null, warmed: false });
      expect(mocks.warm).not.toHaveBeenCalled();
    });

    it("adopts an unknown but well-shaped id, mirroring the first message", async () => {
      const { deps, mocks } = makeDeps();
      mocks.ensureConversation.mockResolvedValue({
        id: "conv-external",
        isNew: true,
      });
      const service = LangyTurnService.create(deps);

      await service.warmConversationWorker(
        warmInput({ requestedConversationId: "conv-external" }),
      );

      expect(mocks.ensureConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: "conv-external",
          adoptUnknownId: true,
        }),
      );
    });
  });

  describe("given the picked model is outside the project's allowlist", () => {
    it("warms nothing rather than booting a worker the turn would reject", async () => {
      const { deps, mocks } = makeDeps();
      mocks.getModelsAllowed.mockResolvedValue(["openai/other-model"]);
      const service = LangyTurnService.create(deps);

      const result = await service.warmConversationWorker(
        warmInput({ modelOverride: "openai/gpt-5-mini" }),
      );

      expect(result.warmed).toBe(false);
      expect(mocks.mintSessionKey).not.toHaveBeenCalled();
      expect(mocks.warm).not.toHaveBeenCalled();
    });
  });
});
