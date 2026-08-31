/**
 * @vitest-environment node
 *
 * The `langy.warmWorker` mutation and the create-path adoption input
 * (specs/langy/langy-worker-prewarm.feature), through the REAL procedures via
 * `createCaller`: warm never throws past the mutation, the adoptable-id shape
 * is gated at the wire, and a create carrying a warmed id threads adoption
 * into the turn service. The turn service itself is mocked, its decisions
 * are covered by langy-warm-worker.unit.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkLangyMessageRateLimit,
  checkLangyWarmRateLimit,
  startConversationTurn,
  warmConversationWorker,
  auditLog,
  getDecision,
  checkScopeLineage,
} = vi.hoisted(() => ({
  checkLangyMessageRateLimit: vi.fn(),
  checkLangyWarmRateLimit: vi.fn(),
  startConversationTurn: vi.fn(),
  warmConversationWorker: vi.fn(),
  auditLog: vi.fn(),
  // The declared permission middleware decides through the App; a permitted
  // decision keeps it out of the way of the mutation under test.
  getDecision: vi.fn(async () => ({
    permitted: true,
    organizationRole: null,
  })),
  // The scope-lineage guard runs ahead of the check on every declared
  // procedure; a single-project input is always consistent.
  checkScopeLineage: vi.fn(async () => ({ kind: "consistent" as const })),
}));

vi.mock("~/server/middleware/rate-limit-langy", () => ({
  checkLangyMessageRateLimit,
  checkLangyWarmRateLimit,
  LANGY_MESSAGES_PER_MINUTE: 30,
  LANGY_WARMS_PER_MINUTE: 60,
}));

vi.mock("~/server/app-layer/app", async () => {
  const { LangyApp } = await import("@langwatch/langy-server");
  // The REAL application, over a stubbed service. `startTurn` is where the
  // adoption flag is threaded into the turn service and where the
  // idempotencyKey/requestId alias is resolved, so a hand-stubbed `langy`
  // would answer the very questions this suite asks.
  const langy = LangyApp.create({
    langy: { startConversationTurn, warmConversationWorker } as never,
    // No Redis: the live edge is not what this suite is about.
    redis: null,
    broadcast: {} as never,
  });
  return {
    tryGetApp: () => null,
    getApp: () => ({
      langy,
      permissions: { getDecision, checkScopeLineage },
      redis: null,
    }),
  };
});

vi.mock("~/runtime/app/features/audit-log", () => ({ auditLog }));

vi.mock("~/server/posthog", () => ({ trackServerEvent: vi.fn() }));

// The UI-action channel is a different Langy surface with its own tests; stub
// it so this suite does not drag the page-action manifests into a unit test of
// the turn path.
vi.mock("~/server/app-layer/langy/ui-actions/ui-action.service", () => ({
  LangyUiActionService: class {
    claim = vi.fn();
    complete = vi.fn();
  },
}));

// The rollout gate and the demo refusal have their own tests
// (langy-access.middleware.unit.test.ts); here they must simply not stand in
// the way of the mutation under test.
vi.mock("../langy-access.middleware", () => ({
  enforceLangyAccess: ({ next }: any) => next(),
  refuseDemoProject: ({ next }: any) => next(),
}));

vi.mock("~/server/api/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/api/rbac")>();
  const passthrough = async ({ ctx, next }: any) => {
    ctx.permissionChecked = true;
    return next();
  };
  return { ...actual, checkProjectPermission: () => passthrough };
});

import { createInnerTRPCContext } from "~/server/api/trpc";
import { langyRouter } from "../langy.router";

const caller = () =>
  langyRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: { id: "user_1", email: "user@example.com" },
        expires: "1",
      } as any,
      req: undefined,
      res: undefined,
      permissionChecked: false,
      publiclyShared: false,
    }),
  );

const message = {
  role: "user" as const,
  parts: [{ type: "text", text: "hi" }],
};

describe("langy.warmWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkLangyMessageRateLimit.mockResolvedValue({ allowed: true });
    checkLangyWarmRateLimit.mockResolvedValue({ allowed: true, remaining: 60 });
    warmConversationWorker.mockResolvedValue({
      conversationId: "conv-warm",
      warmed: true,
    });
    startConversationTurn.mockResolvedValue({
      conversationId: "conv-warm",
      turnId: "turn-1",
    });
  });

  it("returns the service's conversation id and warm state", async () => {
    const result = await caller().warmWorker({
      projectId: "p1",
      modelOverride: "openai/gpt-5-mini",
    });

    expect(result).toEqual({ conversationId: "conv-warm", warmed: true });
    expect(warmConversationWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        requestedConversationId: null,
        modelOverride: "openai/gpt-5-mini",
      }),
    );
  });

  it("passes a supplied conversation id through as the warm target", async () => {
    await caller().warmWorker({
      projectId: "p1",
      conversationId: "conv-existing",
    });

    expect(warmConversationWorker).toHaveBeenCalledWith(
      expect.objectContaining({ requestedConversationId: "conv-existing" }),
    );
  });

  it("rejects a malformed conversation id at the wire", async () => {
    await expect(
      caller().warmWorker({ projectId: "p1", conversationId: "bad id!" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(warmConversationWorker).not.toHaveBeenCalled();
  });

  it("degrades to a cold start once the warm budget is spent", async () => {
    checkLangyWarmRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });

    const result = await caller().warmWorker({ projectId: "p1" });

    // Silent by contract: the panel gets no error, only a cold first message.
    expect(result).toEqual({ conversationId: null, warmed: false });
    expect(warmConversationWorker).not.toHaveBeenCalled();
  });

  it("keeps the warm budget separate from the message budget", async () => {
    await caller().warmWorker({ projectId: "p1" });

    expect(checkLangyWarmRateLimit).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "p1",
    });
    expect(checkLangyMessageRateLimit).not.toHaveBeenCalled();
  });

  it("never throws past the mutation when the service does", async () => {
    warmConversationWorker.mockRejectedValue(new Error("unexpected"));

    const result = await caller().warmWorker({ projectId: "p1" });

    expect(result).toEqual({ conversationId: null, warmed: false });
  });

  it("does not consume the message rate limit", async () => {
    await caller().warmWorker({ projectId: "p1" });

    expect(checkLangyMessageRateLimit).not.toHaveBeenCalled();
  });
});

describe("langy.createConversation adoption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkLangyMessageRateLimit.mockResolvedValue({ allowed: true });
    startConversationTurn.mockResolvedValue({
      conversationId: "conv-warm",
      turnId: "turn-1",
    });
  });

  it("threads adoption for a warmed conversation id", async () => {
    await caller().createConversation({
      projectId: "p1",
      idempotencyKey: "idem-12345",
      conversationId: "conv-warm",
      messages: [message],
    });

    expect(startConversationTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedConversationId: "conv-warm",
        adoptConversationId: true,
      }),
    );
  });

  it("keeps the mint-fresh path when no id is supplied", async () => {
    await caller().createConversation({
      projectId: "p1",
      idempotencyKey: "idem-12345",
      messages: [message],
    });

    const args = startConversationTurn.mock.calls[0]![0] as {
      requestedConversationId: string | null;
      adoptConversationId?: boolean;
    };
    expect(args.requestedConversationId).toBeNull();
    expect(args.adoptConversationId).toBeUndefined();
  });

  it("rejects a malformed adoption id at the wire", async () => {
    await expect(
      caller().createConversation({
        projectId: "p1",
        idempotencyKey: "idem-12345",
        conversationId: "bad id!",
        messages: [message],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(startConversationTurn).not.toHaveBeenCalled();
  });
});
