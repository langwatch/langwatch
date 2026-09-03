import { propagation } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLangyWorkerPort,
  NullLangyWorkerMetricsAdapter,
  UnavailableLangyWorkerAdapter,
} from "../index";

const tracing = vi.hoisted(() => {
  const span = {
    setAttribute: vi.fn(),
  };
  const withActiveSpan = vi.fn(
    async (
      _name: string,
      _options: { attributes: Record<string, string> },
      callback: (activeSpan: typeof span) => Promise<unknown>,
    ) => callback(span),
  );

  return { span, withActiveSpan };
});

vi.mock("langwatch", () => ({
  getLangWatchTracer: vi.fn(() => ({
    withActiveSpan: tracing.withActiveSpan,
  })),
}));

const dispatchInput = {
  intent: "continue" as const,
  conversationId: "conversation-1",
  turnId: "turn-1",
  projectId: "project-1",
  userId: "user-1",
  runToken: "run-token",
  prompt: "hello",
  system: "system",
  credentials: { llmVirtualKey: "key" },
};

function createWorker(metrics = NullLangyWorkerMetricsAdapter.create()) {
  return createLangyWorkerPort({
    agentUrl: "http://agent",
    internalSecret: "secret",
    metrics,
  });
}

describe("createLangyWorkerPort", () => {
  beforeEach(() => {
    tracing.span.setAttribute.mockClear();
    tracing.withActiveSpan.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    [200, "accepted"],
    [202, "accepted"],
    [204, "accepted"],
    [409, "busy"],
    [428, "credentialsRequired"],
    [400, "rejected"],
    [422, "rejected"],
    [401, "unavailable"],
    [404, "unavailable"],
    [408, "unavailable"],
    [429, "unavailable"],
    [500, "unavailable"],
    [503, "unavailable"],
  ] as const)("maps manager status %s to %s", async (status, outcome) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal("fetch", fetchMock);
    const metrics = { recordDispatch: vi.fn() };

    await expect(createWorker(metrics).dispatch(dispatchInput)).resolves.toBe(outcome);

    expect(metrics.recordDispatch).toHaveBeenCalledWith({ outcome });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://agent/worker/continue",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
      }),
    );
  });

  it("sends all optional dispatch fields without changing their names", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await createWorker().dispatch({
      ...dispatchInput,
      historySeed: "history",
      modelOverride: "openai/gpt-5",
      resumeToken: "resume-token",
    });

    const expectedBody = {
      conversationId: "conversation-1",
      turnId: "turn-1",
      projectId: "project-1",
      userId: "user-1",
      runToken: "run-token",
      prompt: "hello",
      system: "system",
      historySeed: "history",
      credentials: { llmVirtualKey: "key" },
      modelOverride: "openai/gpt-5",
      resumeToken: "resume-token",
    };
    expect(fetchMock).toHaveBeenCalledWith(
      "http://agent/worker/continue",
      expect.objectContaining({ body: JSON.stringify(expectedBody) }),
    );
  });

  it("returns true only for a valid live probe response", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ alive: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createWorker().probe({
        projectId: "project-1",
        actorUserId: "user-1",
        conversationId: "conversation-1",
        hasGithubAuth: false,
      }),
    ).resolves.toBe(true);
  });

  it.each([
    ["non-success response", new Response(null, { status: 503 })],
    ["invalid JSON", new Response("{", { status: 200 })],
    [
      "invalid response shape",
      new Response(JSON.stringify({ alive: "yes" }), { status: 200 }),
    ],
    [
      "explicitly cold worker",
      new Response(JSON.stringify({ alive: false }), { status: 200 }),
    ],
  ])("fails open for a probe with %s", async (_case, response) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response));

    await expect(
      createWorker().probe({
        projectId: "project-1",
        actorUserId: "user-1",
        conversationId: "conversation-1",
        hasGithubAuth: false,
      }),
    ).resolves.toBe(false);
  });

  it("sends every optional probe field without changing its name", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ alive: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createWorker().probe({
      projectId: "project-1",
      actorUserId: "user-1",
      conversationId: "conversation-1",
      model: "openai/gpt-5",
      hasGithubAuth: true,
      githubRepoScopeKey: "github:repo",
      egressAllowlist: ["api.example.com"],
      mirrorTier: "warm",
      harness: "opencode",
    });

    const expectedBody = {
      projectId: "project-1",
      actorUserId: "user-1",
      conversationId: "conversation-1",
      model: "openai/gpt-5",
      hasGithubAuth: true,
      githubRepoScopeKey: "github:repo",
      egressAllowlist: ["api.example.com"],
      mirrorTier: "warm",
      harness: "opencode",
    };
    expect(fetchMock).toHaveBeenCalledWith(
      "http://agent/worker/probe",
      expect.objectContaining({ body: JSON.stringify(expectedBody) }),
    );
  });

  it("warms with the optional model override and cancels the response body", async () => {
    const response = new Response("ignored", { status: 202 });
    const cancel = vi.spyOn(response.body!, "cancel");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    await createWorker().warm({
      projectId: "project-1",
      actorUserId: "user-1",
      conversationId: "conversation-1",
      credentials: { llmVirtualKey: "key" },
      modelOverride: "openai/gpt-5",
    });

    const expectedBody = {
      projectId: "project-1",
      actorUserId: "user-1",
      conversationId: "conversation-1",
      credentials: { llmVirtualKey: "key" },
      modelOverride: "openai/gpt-5",
    };
    expect(fetchMock).toHaveBeenCalledWith(
      "http://agent/warm",
      expect.objectContaining({ body: JSON.stringify(expectedBody) }),
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["warm", "cancel"] as const)("swallows a failed %s request", async (method) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));
    const worker = createWorker();

    const operation =
      method === "warm"
        ? worker.warm({
            projectId: "project-1",
            actorUserId: "user-1",
            conversationId: "conversation-1",
            credentials: { llmVirtualKey: "key" },
          })
        : worker.cancel({
            projectId: "project-1",
            conversationId: "conversation-1",
            turnId: "turn-1",
          });

    await expect(operation).resolves.toBeUndefined();
  });

  it.each(["dispatch", "cancel"] as const)(
    "cancels the %s response body",
    async (method) => {
      const response = new Response("ignored", { status: 202 });
      const cancel = vi.spyOn(response.body!, "cancel");
      vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response));
      const worker = createWorker();

      if (method === "dispatch") {
        await worker.dispatch(dispatchInput);
      } else {
        await worker.cancel({
          projectId: "project-1",
          conversationId: "conversation-1",
          turnId: "turn-1",
        });
      }

      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it("injects the active trace context into manager requests", async () => {
    const inject = vi.spyOn(propagation, "inject");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await createWorker().dispatch(dispatchInput);

    expect(inject).toHaveBeenCalledOnce();
    const traceCarrier = inject.mock.calls[0]?.[1];
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.headers).toBe(traceCarrier);
    expect(traceCarrier).toEqual(
      expect.objectContaining({ Authorization: "Bearer secret" }),
    );
  });

  it("delegates span origin and status lifecycle to the LangWatch tracer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 })),
    );

    await createWorker().dispatch(dispatchInput);

    expect(tracing.withActiveSpan).toHaveBeenCalledWith(
      "langy.chat.dispatch_turn",
      {
        attributes: {
          "tenant.id": "project-1",
          "user.id": "user-1",
          "langy.conversation.id": "conversation-1",
          "langy.turn.id": "turn-1",
          "langy.worker.intent": "continue",
        },
      },
      expect.any(Function),
    );
    expect(tracing.span.setAttribute).toHaveBeenCalledWith(
      "langy.dispatch.outcome",
      "accepted",
    );
  });

  it("fails open and records an error when dispatch cannot reach the manager", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));
    const metrics = { recordDispatch: vi.fn() };

    await expect(createWorker(metrics).dispatch(dispatchInput)).resolves.toBe(
      "unavailable",
    );

    expect(metrics.recordDispatch).toHaveBeenCalledWith({ outcome: "error" });
    expect(tracing.span.setAttribute).toHaveBeenCalledWith(
      "langy.dispatch.outcome",
      "error",
    );
  });
});

describe("UnavailableLangyWorkerAdapter", () => {
  it("implements the complete port without making network requests", async () => {
    const metrics = { recordDispatch: vi.fn() };
    const worker = UnavailableLangyWorkerAdapter.create(metrics);

    await expect(
      worker.probe({
        projectId: "project-1",
        actorUserId: "user-1",
        conversationId: "conversation-1",
        hasGithubAuth: false,
      }),
    ).resolves.toBe(false);
    await expect(
      worker.warm({
        projectId: "project-1",
        actorUserId: "user-1",
        conversationId: "conversation-1",
        credentials: {},
      }),
    ).resolves.toBeUndefined();
    await expect(worker.dispatch(dispatchInput)).resolves.toBe("unavailable");
    await expect(
      worker.cancel({
        projectId: "project-1",
        conversationId: "conversation-1",
        turnId: "turn-1",
      }),
    ).resolves.toBeUndefined();
    expect(metrics.recordDispatch).toHaveBeenCalledWith({ outcome: "error" });
  });
});
