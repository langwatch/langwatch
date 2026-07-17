import { describe, expect, it, vi } from "vitest";

import type { LangyTurnHandoff } from "../../streaming/langyTurnHandoff";
import { LangyTurnDispatchRetry } from "../../langy-turn-retry.error";
import { createLangyEffectPorts } from "../langyEffectPorts";

const PROJECT = "project-1";
const CONVERSATION = "conversation-1";
const TURN = "turn-1";

function handoff(overrides: Partial<LangyTurnHandoff> = {}): LangyTurnHandoff {
  return {
    projectId: PROJECT,
    conversationId: CONVERSATION,
    turnId: TURN,
    actorUserId: "user-1",
    prompt: "Fix my trace",
    system: "System prompt",
    credentials: {
      langwatchApiKey: "sk-lw-turn",
      langwatchApiKeyId: "key-1",
      llmVirtualKey: "vk-1",
      langwatchEndpoint: "https://langwatch.test",
      gatewayBaseUrl: "https://gateway.test/v1",
      organizationId: "organization-1",
    },
    runToken: "run-token",
    permitReserved: false,
    ...overrides,
  };
}

function makeDeps(value: LangyTurnHandoff | null = handoff()) {
  return {
    handoffStore: {
      read: vi.fn().mockResolvedValue(value),
      stash: vi.fn().mockResolvedValue(undefined),
    },
    worker: { dispatch: vi.fn().mockResolvedValue("accepted") },
    mintSessionKey: vi.fn().mockResolvedValue({
      token: "sk-lw-recovered",
      apiKeyId: "key-recovered",
    }),
    revokeSessionKey: vi.fn().mockResolvedValue(undefined),
    titleGenerator: vi.fn().mockResolvedValue(null),
    saveTitle: vi.fn().mockResolvedValue(undefined),
  };
}

const dispatchParams = {
  projectId: PROJECT,
  conversationId: CONVERSATION,
  turnId: TURN,
  resumeFromTurnId: null,
};

describe("createLangyEffectPorts", () => {
  describe.each([
    {
      label: "create",
      stored: handoff(),
      expectedIntent: "create",
    },
    {
      label: "continue",
      stored: handoff({
        credentials: {
          llmVirtualKey: "vk-1",
          langwatchEndpoint: "https://langwatch.test",
          gatewayBaseUrl: "https://gateway.test/v1",
          organizationId: "organization-1",
        },
      }),
      expectedIntent: "continue",
    },
    {
      label: "revive",
      stored: handoff({ resumeToken: "resume-token" }),
      expectedIntent: "revive",
    },
  ])("worker $label dispatch", ({ stored, expectedIntent }) => {
    it("reads and validates the handoff before mapping the worker request", async () => {
      const deps = makeDeps(stored);
      const ports = createLangyEffectPorts(deps);

      await ports.workerDispatch.dispatchTurn(dispatchParams);

      expect(deps.handoffStore.read).toHaveBeenCalledWith({
        conversationId: CONVERSATION,
        turnId: TURN,
      });
      expect(deps.worker.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: expectedIntent,
          projectId: PROJECT,
          conversationId: CONVERSATION,
          turnId: TURN,
          userId: "user-1",
          runToken: "run-token",
          prompt: "Fix my trace",
          system: "System prompt",
          credentials: stored.credentials,
          ...(expectedIntent === "revive"
            ? { resumeToken: "resume-token" }
            : {}),
        }),
      );
    });
  });

  it("treats a missing or expired handoff as a safe no-op", async () => {
    const deps = makeDeps(null);
    const ports = createLangyEffectPorts(deps);

    await expect(
      ports.workerDispatch.dispatchTurn(dispatchParams),
    ).resolves.toBeUndefined();
    expect(deps.worker.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    handoff({ projectId: "other-project" }),
    handoff({ conversationId: "other-conversation" }),
    handoff({ turnId: "other-turn" }),
  ])("rejects a handoff whose identity does not match the intent", async (stored) => {
    const deps = makeDeps(stored);
    const ports = createLangyEffectPorts(deps);

    await expect(
      ports.workerDispatch.dispatchTurn(dispatchParams),
    ).rejects.toThrow("Langy turn handoff identity mismatch");
    expect(deps.worker.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    "busy",
    "unavailable",
  ] as const)("throws a retry signal when worker dispatch returns %s", async (outcome) => {
    const deps = makeDeps();
    deps.worker.dispatch.mockResolvedValue(outcome);
    const ports = createLangyEffectPorts(deps);

    await expect(
      ports.workerDispatch.dispatchTurn(dispatchParams),
    ).rejects.toBeInstanceOf(LangyTurnDispatchRetry);
  });

  it("recovers a stale probe by minting once, replacing the handoff, and redriving", async () => {
    const stored = handoff({
      credentials: {
        llmVirtualKey: "vk-1",
        langwatchEndpoint: "https://langwatch.test",
        gatewayBaseUrl: "https://gateway.test/v1",
        organizationId: "organization-1",
      },
    });
    const deps = makeDeps(stored);
    deps.worker.dispatch
      .mockResolvedValueOnce("credentialsRequired")
      .mockResolvedValueOnce("accepted");
    const ports = createLangyEffectPorts(deps);

    await ports.workerDispatch.dispatchTurn(dispatchParams);

    expect(deps.mintSessionKey).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: PROJECT,
      organizationId: "organization-1",
    });
    expect(deps.handoffStore.stash).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({
          langwatchApiKey: "sk-lw-recovered",
          langwatchApiKeyId: "key-recovered",
        }),
      }),
    );
    expect(deps.worker.dispatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        intent: "create",
        credentials: expect.objectContaining({
          langwatchApiKey: "sk-lw-recovered",
        }),
      }),
    );
  });

  it("revokes a recovery key that could not be persisted for retry", async () => {
    const stored = handoff({
      credentials: {
        llmVirtualKey: "vk-1",
        langwatchEndpoint: "https://langwatch.test",
        gatewayBaseUrl: "https://gateway.test/v1",
        organizationId: "organization-1",
      },
    });
    const deps = makeDeps(stored);
    deps.worker.dispatch.mockResolvedValueOnce("credentialsRequired");
    deps.handoffStore.stash.mockRejectedValueOnce(new Error("redis down"));
    const ports = createLangyEffectPorts(deps);

    await expect(
      ports.workerDispatch.dispatchTurn(dispatchParams),
    ).rejects.toThrow("redis down");
    expect(deps.revokeSessionKey).toHaveBeenCalledWith({
      apiKeyId: "key-recovered",
    });
  });

  it("does not save a title when the trusted generator returns null", async () => {
    const deps = makeDeps();
    const ports = createLangyEffectPorts(deps);

    await ports.titleGeneration.generateTitle({
      projectId: PROJECT,
      conversationId: CONVERSATION,
      turnId: TURN,
    });

    expect(deps.titleGenerator).toHaveBeenCalledWith({
      projectId: PROJECT,
      conversationId: CONVERSATION,
    });
    expect(deps.saveTitle).not.toHaveBeenCalled();
  });

  it("saves a generated title with the triggering turn identity", async () => {
    const deps = makeDeps();
    deps.titleGenerator.mockResolvedValue({
      title: "Fix Trace Ingestion",
      model: "openai/gpt-5-mini",
    });
    const ports = createLangyEffectPorts(deps);

    await ports.titleGeneration.generateTitle({
      projectId: PROJECT,
      conversationId: CONVERSATION,
      turnId: TURN,
    });

    expect(deps.saveTitle).toHaveBeenCalledWith({
      projectId: PROJECT,
      conversationId: CONVERSATION,
      turnId: TURN,
      title: "Fix Trace Ingestion",
      model: "openai/gpt-5-mini",
    });
  });
});
