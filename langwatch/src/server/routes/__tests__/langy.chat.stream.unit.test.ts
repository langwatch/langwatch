/**
 * Binds langy-baseline.feature § "Stream responses token by token".
 *
 * Exercises the chat route end-to-end through `app.request`, with a stub
 * MockLanguageModelV3 plugged in via `getVercelAIModel`. All Langy DB
 * services are mocked so this stays in the unit-test budget (no Docker).
 */
import { simulateReadableStream } from "ai/test";
import { MockLanguageModelV3 } from "ai/test";

// The `chunks` we feed `simulateReadableStream` are typed loosely by upstream;
// `MockLanguageModelV3`'s `doStream` wants `ReadableStream<LanguageModelV3StreamPart>`.
// We assert at the boundary instead of fighting deep generic narrowing in tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DoStreamFactory = (...args: any[]) => Promise<{ stream: ReadableStream<any> }>;
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must precede the route import.
// ---------------------------------------------------------------------------

const mockGetServerAuthSession = vi.fn();
const mockHasProjectPermission = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockGetVercelAIModel = vi.fn();
const mockEnsureConversation = vi.fn();
const mockTouchConversation = vi.fn();
const mockGetProjectMemory = vi.fn();
const mockGetUserPrefs = vi.fn();
const mockAppendMessage = vi.fn();
const mockFeatureFlagIsEnabled = vi.fn();
const mockStreamLangyMastraResponse = vi.fn();

vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) =>
    mockGetServerAuthSession(...args),
}));

vi.mock("~/server/api/rbac", () => ({
  hasProjectPermission: (...args: unknown[]) =>
    mockHasProjectPermission(...args),
}));

vi.mock("~/server/middleware/rate-limit-langy", () => ({
  LANGY_TOOL_CALLS_PER_MESSAGE: 5,
  checkLangyMessageRateLimit: (...args: unknown[]) =>
    mockCheckRateLimit(...args),
}));

vi.mock("~/server/modelProviders/utils", () => ({
  getVercelAIModel: (...args: unknown[]) => mockGetVercelAIModel(...args),
}));

vi.mock("~/server/app-layer/clients/tokenizer/tiktoken.client", () => ({
  TiktokenClient: class {
    async countTokens(): Promise<number> {
      return 1;
    }
  },
}));

vi.mock("~/server/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

const mockEvaluatorGetAllWithFields = vi.fn();
const mockEvaluatorGetBySlug = vi.fn();
vi.mock("~/server/evaluators/evaluator.service", () => ({
  EvaluatorService: {
    create: () => ({
      getAllWithFields: (...args: unknown[]) =>
        mockEvaluatorGetAllWithFields(...args),
      getBySlug: (...args: unknown[]) => mockEvaluatorGetBySlug(...args),
    }),
  },
}));

const mockPrismaExperimentFindFirst = vi.fn();
vi.mock("~/server/db", () => ({
  prisma: {
    experiment: {
      findFirst: (...args: unknown[]) =>
        mockPrismaExperimentFindFirst(...args),
    },
  },
}));

const mockBuildLangyTelemetrySettings = vi.fn();
vi.mock("~/server/observability/langy-tracer", async () => {
  const actual = await vi.importActual<
    typeof import("~/server/observability/langy-tracer")
  >("~/server/observability/langy-tracer");
  return {
    ...actual,
    buildLangyTelemetrySettings: (
      ...args: Parameters<typeof actual.buildLangyTelemetrySettings>
    ) => {
      mockBuildLangyTelemetrySettings(...args);
      return actual.buildLangyTelemetrySettings(...args);
    },
  };
});

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: {
    isEnabled: (...args: unknown[]) => mockFeatureFlagIsEnabled(...args),
  },
}));

vi.mock("~/server/services/langy/mastra-agent", () => ({
  streamLangyMastraResponse: (...args: unknown[]) =>
    mockStreamLangyMastraResponse(...args),
}));

vi.mock("~/server/services/langy", () => ({
  LangyConversationService: {
    create: () => ({
      ensureConversation: (...args: unknown[]) =>
        mockEnsureConversation(...args),
      touch: (...args: unknown[]) => mockTouchConversation(...args),
    }),
  },
  LangyMessageService: {
    create: () => ({
      append: (...args: unknown[]) => mockAppendMessage(...args),
    }),
  },
  LangyProjectMemoryService: {
    create: () => ({
      getById: (...args: unknown[]) => mockGetProjectMemory(...args),
    }),
  },
  LangyUserPreferencesService: {
    create: () => ({
      getById: (...args: unknown[]) => mockGetUserPrefs(...args),
    }),
  },
}));

const { app } = await import("../langy");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStubModel(textChunks: string[]) {
  const doStream: DoStreamFactory = async () => ({
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "response-metadata", id: "rsp-1", modelId: "mock-1" },
        { type: "text-start", id: "txt-1" },
        ...textChunks.map((delta) => ({
          type: "text-delta" as const,
          id: "txt-1",
          delta,
        })),
        { type: "text-end", id: "txt-1" },
        {
          type: "finish",
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
      ],
      initialDelayInMs: null,
      chunkDelayInMs: null,
    }) as never,
  });
  return new MockLanguageModelV3({ doStream });
}

/**
 * Two-turn stub model: first turn invokes `toolName` with `input`,
 * second turn emits a short final text. Used to exercise the tool
 * execute path (project scoping, return-value shape) end-to-end.
 *
 * The V3 contract expects tool-input-start/-end to envelope the
 * tool-call so streamText can track partial-input state correctly.
 */
function makeToolCallingStubModel(toolName: string, input: unknown) {
  const stringifiedInput = JSON.stringify(input);
  const turnBuilders = [
    () =>
      simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "response-metadata", id: "rsp-1", modelId: "mock-1" },
          { type: "tool-input-start", id: "tc-1", toolName },
          {
            type: "tool-input-delta",
            id: "tc-1",
            delta: stringifiedInput,
          },
          { type: "tool-input-end", id: "tc-1" },
          {
            type: "tool-call",
            toolCallId: "tc-1",
            toolName,
            input: stringifiedInput,
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          },
        ],
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
    () =>
      simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "response-metadata", id: "rsp-2", modelId: "mock-1" },
          { type: "text-start", id: "txt-1" },
          { type: "text-delta", id: "txt-1", delta: "ok" },
          { type: "text-end", id: "txt-1" },
          {
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          },
        ],
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
  ];
  // Workaround for an off-by-one in MockLanguageModelV3: it indexes
  // doStream by `doStreamCalls.length` AFTER pushing, so a plain
  // array would skip the first turn. We track our own counter and
  // clamp to the last turn for any extra calls.
  let turnIndex = 0;
  const doStream: DoStreamFactory = async () => {
    const builder =
      turnBuilders[turnIndex] ?? turnBuilders[turnBuilders.length - 1]!;
    turnIndex += 1;
    return { stream: builder() as never };
  };
  return new MockLanguageModelV3({ doStream });
}

async function readBody(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += decoder.decode(value);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Default-happy mocks
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerAuthSession.mockResolvedValue({
    user: { id: "user_42", email: "tester@example.com" },
    expires: "2099-01-01",
  });
  mockHasProjectPermission.mockResolvedValue(true);
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockGetProjectMemory.mockResolvedValue(null);
  mockGetUserPrefs.mockResolvedValue({ mode: "non-expert" });
  mockFeatureFlagIsEnabled.mockResolvedValue(false);
  mockStreamLangyMastraResponse.mockReset();
  mockEvaluatorGetAllWithFields.mockResolvedValue([]);
  mockEvaluatorGetBySlug.mockResolvedValue(null);
  mockPrismaExperimentFindFirst.mockResolvedValue(null);
  mockEnsureConversation.mockResolvedValue({ id: "conv_test_abc" });
  mockTouchConversation.mockResolvedValue(undefined);
  mockAppendMessage.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

describe("POST /api/langy/chat streaming — binds langy-baseline.feature § stream responses token by token", () => {
  describe("given a happy-path chat with a stub model emitting three deltas", () => {
    beforeEach(() => {
      mockGetVercelAIModel.mockResolvedValue(
        makeStubModel(["Hel", "lo, ", "world."]),
      );
    });

    describe("when a user message is POSTed", () => {
      it("returns a 200 streaming response", async () => {
        const res = await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: "proj_demo",
            messages: [
              {
                id: "m1",
                role: "user",
                parts: [{ type: "text", text: "Hi" }],
              },
            ],
          }),
        });
        expect(res.status).toBe(200);
      });

      it("propagates the conversation id back via x-langy-conversation-id", async () => {
        const res = await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: "proj_demo",
            messages: [
              {
                id: "m1",
                role: "user",
                parts: [{ type: "text", text: "Hi" }],
              },
            ],
          }),
        });
        expect(res.headers.get("x-langy-conversation-id")).toBe(
          "conv_test_abc",
        );
      });

      it("streams the text deltas as discrete chunks in the response body", async () => {
        const res = await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: "proj_demo",
            messages: [
              {
                id: "m1",
                role: "user",
                parts: [{ type: "text", text: "Hi" }],
              },
            ],
          }),
        });
        const body = await readBody(res);
        // The UI message stream surfaces each text-delta event as a
        // line in the SSE body. We assert each fragment appears.
        expect(body).toContain("Hel");
        expect(body).toContain("lo, ");
        expect(body).toContain("world.");
      });

      it("calls getVercelAIModel with the request's projectId — binds langy-baseline.feature § tool calls scoped to active project", async () => {
        await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: "proj_demo",
            messages: [
              {
                id: "m1",
                role: "user",
                parts: [{ type: "text", text: "Hi" }],
              },
            ],
          }),
        });
        expect(mockGetVercelAIModel).toHaveBeenCalledWith("proj_demo");
      });

      it("attaches Langy self-observability metadata to streamText — binds PR-1.3", async () => {
        await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: "proj_demo",
            messages: [
              {
                id: "m1",
                role: "user",
                parts: [{ type: "text", text: "Hi" }],
              },
            ],
          }),
        });
        // The route must build telemetry from the request's projectId,
        // session userId, and the ensured conversation id. The dogfood
        // project filters on these — see langy-tracer.ts.
        expect(mockBuildLangyTelemetrySettings).toHaveBeenCalledWith({
          userProjectId: "proj_demo",
          userId: "user_42",
          conversationId: "conv_test_abc",
          mode: "non-expert",
        });
      });

      it("persists the user message via LangyMessageService.append", async () => {
        await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: "proj_demo",
            messages: [
              {
                id: "m1",
                role: "user",
                parts: [{ type: "text", text: "Hi" }],
              },
            ],
          }),
        });
        // Wait a tick — append may be queued in onFinish.
        await new Promise((r) => setTimeout(r, 50));
        expect(mockAppendMessage).toHaveBeenCalled();
        const firstCall = mockAppendMessage.mock.calls[0]?.[0] as {
          role: string;
          projectId: string;
        };
        expect(firstCall.role).toBe("user");
        expect(firstCall.projectId).toBe("proj_demo");
      });
    });
  });

  describe("given the stub model invokes list_evaluators — binds langy-baseline.feature § ask what evaluators exist + § tool calls scoped to active project", () => {
    beforeEach(() => {
      mockGetVercelAIModel.mockResolvedValue(
        makeToolCallingStubModel("list_evaluators", { scope: "project" }),
      );
      mockEvaluatorGetAllWithFields.mockResolvedValue([
        {
          id: "ev_1",
          slug: "ragas-faithfulness",
          name: "RagFaithfulness",
          type: "ragas",
          fields: [{ identifier: "input" }, { identifier: "output" }],
        },
        {
          id: "ev_2",
          slug: "toxicity",
          name: "Toxicity",
          type: "presidio",
          fields: [{ identifier: "output" }],
        },
      ]);
    });

    describe("when the chat triggers the tool", () => {
      it("calls EvaluatorService.getAllWithFields with the active project id", async () => {
        const res = await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: "proj_demo",
            messages: [
              {
                id: "m1",
                role: "user",
                parts: [
                  { type: "text", text: "what evaluators are configured?" },
                ],
              },
            ],
          }),
        });
        const body = await readBody(res);
        if (mockEvaluatorGetAllWithFields.mock.calls.length === 0) {
          // eslint-disable-next-line no-console
          console.error("tool-call test: body=", body);
        }
        expect(mockEvaluatorGetAllWithFields).toHaveBeenCalledWith({
          projectId: "proj_demo",
        });
      });

      it("never asks the evaluator service for a different project's data", async () => {
        const res = await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: "proj_demo",
            messages: [
              {
                id: "m1",
                role: "user",
                parts: [
                  { type: "text", text: "what evaluators are configured?" },
                ],
              },
            ],
          }),
        });
        await readBody(res);
        expect(mockEvaluatorGetAllWithFields.mock.calls.length).toBeGreaterThan(0);
        for (const call of mockEvaluatorGetAllWithFields.mock.calls) {
          const arg = call[0] as { projectId: string };
          expect(arg.projectId).toBe("proj_demo");
        }
      });
    });
  });

  describe("given the stub model invokes find_failing_rows — binds langy-baseline.feature § ask why rows are failing", () => {
    beforeEach(() => {
      mockGetVercelAIModel.mockResolvedValue(
        makeToolCallingStubModel("find_failing_rows", { limit: 10 }),
      );
    });

    describe("when the chat triggers the tool with an active experimentSlug", () => {
      it("scopes the experiment lookup to the request's projectId", async () => {
        const res = await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: "proj_demo",
            experimentSlug: "exp1",
            messages: [
              {
                id: "m1",
                role: "user",
                parts: [
                  { type: "text", text: "which rows are failing?" },
                ],
              },
            ],
          }),
        });
        await readBody(res);
        expect(mockPrismaExperimentFindFirst).toHaveBeenCalledWith({
          where: { projectId: "proj_demo", slug: "exp1" },
        });
      });
    });

    describe("when no experimentSlug is in scope", () => {
      it("does not touch the experiment table at all", async () => {
        const res = await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: "proj_demo",
            messages: [
              {
                id: "m1",
                role: "user",
                parts: [
                  { type: "text", text: "which rows are failing?" },
                ],
              },
            ],
          }),
        });
        await readBody(res);
        expect(mockPrismaExperimentFindFirst).not.toHaveBeenCalled();
      });
    });
  });
});

describe("POST /api/langy/chat system prompt — binds langy-baseline.feature § Switch to expert mode (prompt half)", () => {
  // The system prompt is passed directly to the model's `doStream`, so we
  // capture the first call's `system` field and inspect it.
  function makeCapturingStubModel() {
    const captured: { system?: string } = {};
    const doStream: DoStreamFactory = async (args: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prompt?: Array<{ role: string; content: any }>;
      system?: string;
    }) => {
      if (typeof args.system === "string") {
        captured.system = args.system;
      } else if (Array.isArray(args.prompt)) {
        const systemMsg = args.prompt.find((m) => m.role === "system");
        if (systemMsg) {
          captured.system =
            typeof systemMsg.content === "string"
              ? systemMsg.content
              : Array.isArray(systemMsg.content)
                ? systemMsg.content
                    .map((p: { text?: string }) => p.text ?? "")
                    .join("")
                : "";
        }
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "response-metadata", id: "rsp-1", modelId: "mock-1" },
            { type: "text-start", id: "txt-1" },
            { type: "text-delta", id: "txt-1", delta: "ok" },
            { type: "text-end", id: "txt-1" },
            {
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ],
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }) as never,
      };
    };
    return { model: new MockLanguageModelV3({ doStream }), captured };
  }

  async function sendMessage(): Promise<void> {
    const res = await app.request("/api/langy/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "proj_demo",
        messages: [
          {
            id: "m1",
            role: "user",
            parts: [{ type: "text", text: "hi" }],
          },
        ],
      }),
    });
    await readBody(res);
  }

  describe("given preferences.mode is 'expert'", () => {
    it("passes the expert-mode suffix in the system prompt", async () => {
      const { model, captured } = makeCapturingStubModel();
      mockGetVercelAIModel.mockResolvedValue(model);
      mockGetUserPrefs.mockResolvedValue({ mode: "expert" });

      await sendMessage();

      expect(captured.system).toBeDefined();
      expect(captured.system).toContain("Mode: expert");
      expect(captured.system).toContain("Be terse");
      expect(captured.system).not.toContain("Mode: non-expert");
    });
  });

  describe("given preferences.mode is 'non_expert'", () => {
    it("passes the non-expert-mode suffix in the system prompt", async () => {
      const { model, captured } = makeCapturingStubModel();
      mockGetVercelAIModel.mockResolvedValue(model);
      mockGetUserPrefs.mockResolvedValue({ mode: "non_expert" });

      await sendMessage();

      expect(captured.system).toBeDefined();
      expect(captured.system).toContain("Mode: non-expert");
      expect(captured.system).toContain("plain language");
      expect(captured.system).not.toContain("Mode: expert");
    });
  });
});

describe("POST /api/langy/chat tool-output validation — binds langy-baseline.feature § Langy cannot act on entities it never looked up", () => {
  async function sendMessage(): Promise<string> {
    const res = await app.request("/api/langy/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "proj_demo",
        messages: [
          {
            id: "m1",
            role: "user",
            parts: [{ type: "text", text: "go" }],
          },
        ],
      }),
    });
    return readBody(res);
  }

  describe("given the model calls propose_update_evaluator with an unlisted slug", () => {
    beforeEach(() => {
      mockGetVercelAIModel.mockResolvedValue(
        makeToolCallingStubModel("propose_update_evaluator", {
          slug: "ghost-evaluator",
          settings: { foo: "bar" },
          rationale: "test",
        }),
      );
    });

    it("returns the validator error and never asks the service for the slug", async () => {
      const body = await sendMessage();
      expect(body).toContain("not surfaced by list_evaluators");
      expect(mockEvaluatorGetBySlug).not.toHaveBeenCalled();
    });
  });

  describe("given the model calls propose_update_prompt with an unlisted id", () => {
    beforeEach(() => {
      mockGetVercelAIModel.mockResolvedValue(
        makeToolCallingStubModel("propose_update_prompt", {
          id: "prm_fabricated",
          commitMessage: "test",
          rationale: "test",
        }),
      );
    });

    it("returns the validator error referencing list_prompts", async () => {
      const body = await sendMessage();
      expect(body).toContain("not surfaced by list_prompts");
    });
  });

  describe("given the model calls propose_add_dataset_rows with an unlisted datasetId", () => {
    beforeEach(() => {
      mockGetVercelAIModel.mockResolvedValue(
        makeToolCallingStubModel("propose_add_dataset_rows", {
          datasetId: "ds_fabricated",
          rows: [{ a: 1 }],
          rationale: "test",
        }),
      );
    });

    it("returns the validator error referencing list_datasets", async () => {
      const body = await sendMessage();
      expect(body).toContain("not surfaced by list_datasets");
    });
  });
});

describe("POST /api/langy/chat tool-call cap — binds langy-baseline.feature § Runaway agent loops are capped per message", () => {
  // The rate-limit module mock pins LANGY_TOOL_CALLS_PER_MESSAGE = 5 at the
  // top of this file, and the chat route does stepCountIs(...) with that
  // value. A model that always emits a tool call would otherwise loop
  // forever; we prove the cap halts it.

  /** Model that emits list_evaluators on every turn (never produces final text). */
  function makeAlwaysToolModel(): {
    model: MockLanguageModelV3;
    calls: { count: number };
  } {
    const calls = { count: 0 };
    const stringifiedInput = JSON.stringify({ scope: "project" });
    const doStream: DoStreamFactory = async () => {
      calls.count += 1;
      const id = `tc-${calls.count}`;
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "response-metadata",
              id: `rsp-${calls.count}`,
              modelId: "mock-1",
            },
            { type: "tool-input-start", id, toolName: "list_evaluators" },
            { type: "tool-input-delta", id, delta: stringifiedInput },
            { type: "tool-input-end", id },
            {
              type: "tool-call",
              toolCallId: id,
              toolName: "list_evaluators",
              input: stringifiedInput,
            },
            {
              type: "finish",
              finishReason: "tool-calls",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ],
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }) as never,
      };
    };
    return { model: new MockLanguageModelV3({ doStream }), calls };
  }

  describe("given a model that always requests a tool call", () => {
    it("halts at LANGY_TOOL_CALLS_PER_MESSAGE model invocations", async () => {
      const { model, calls } = makeAlwaysToolModel();
      mockGetVercelAIModel.mockResolvedValue(model);

      const res = await app.request("/api/langy/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "proj_demo",
          messages: [
            {
              id: "m1",
              role: "user",
              parts: [{ type: "text", text: "loop forever" }],
            },
          ],
        }),
      });
      await readBody(res);

      // Mock at top of file: LANGY_TOOL_CALLS_PER_MESSAGE = 5.
      // stepCountIs(5) means the model is invoked at most 5 times.
      expect(calls.count).toBeLessThanOrEqual(5);
      // And it must have actually iterated more than once — otherwise we'd
      // just be testing that streamText returns after a single call.
      expect(calls.count).toBeGreaterThan(1);
    });
  });
});

describe("POST /api/langy/chat — Mastra path (PR-4.3 spike behind feature flag)", () => {
  describe("given the release_ui_langy_mastra_enabled flag is OFF", () => {
    beforeEach(() => {
      mockFeatureFlagIsEnabled.mockResolvedValue(false);
      mockGetVercelAIModel.mockResolvedValue(
        makeStubModel(["legacy path"]),
      );
    });

    it("does not invoke the Mastra agent", async () => {
      const res = await app.request("/api/langy/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "proj_demo",
          messages: [
            {
              id: "m1",
              role: "user",
              parts: [{ type: "text", text: "hello" }],
            },
          ],
        }),
      });
      await readBody(res);
      expect(mockStreamLangyMastraResponse).not.toHaveBeenCalled();
    });
  });

  describe("given the release_ui_langy_mastra_enabled flag is ON", () => {
    beforeEach(() => {
      mockFeatureFlagIsEnabled.mockResolvedValue(true);
      mockGetVercelAIModel.mockResolvedValue(makeStubModel(["unused"]));
      mockStreamLangyMastraResponse.mockResolvedValue(
        new Response("mastra-streamed", { status: 200 }),
      );
    });

    it("routes the request through the Mastra agent instead of streamText", async () => {
      const res = await app.request("/api/langy/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "proj_demo",
          messages: [
            {
              id: "m1",
              role: "user",
              parts: [{ type: "text", text: "hello" }],
            },
          ],
        }),
      });
      expect(res.status).toBe(200);
      expect(mockStreamLangyMastraResponse).toHaveBeenCalledTimes(1);
    });

    it("forwards projectId, model, systemPrompt, and tool-cap to the Mastra agent", async () => {
      await app.request("/api/langy/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "proj_demo",
          messages: [
            {
              id: "m1",
              role: "user",
              parts: [{ type: "text", text: "hello" }],
            },
          ],
        }),
      });
      expect(mockStreamLangyMastraResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          ctx: expect.objectContaining({ projectId: "proj_demo" }),
          systemPrompt: expect.stringContaining("Mode:"),
          maxSteps: 5, // LANGY_TOOL_CALLS_PER_MESSAGE pinned at top of file
        }),
      );
    });

    it("preserves the x-langy-conversation-id header on the Mastra response", async () => {
      const res = await app.request("/api/langy/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "proj_demo",
          messages: [
            {
              id: "m1",
              role: "user",
              parts: [{ type: "text", text: "hello" }],
            },
          ],
        }),
      });
      expect(res.headers.get("x-langy-conversation-id")).toBe("conv_test_abc");
    });

    describe("when the Mastra path takes over (PR-4.4 part a — assistant-message persistence)", () => {
      it("forwards an onFinish callback so assistant turns persist (no longer dropped silently)", async () => {
        await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: "proj_demo",
            messages: [
              {
                id: "m1",
                role: "user",
                parts: [{ type: "text", text: "hello" }],
              },
            ],
          }),
        });

        expect(mockStreamLangyMastraResponse).toHaveBeenCalledWith(
          expect.objectContaining({
            onFinish: expect.any(Function),
          }),
        );

        // And the callback wires through to the same persistence path the
        // legacy onFinish uses — invoking it should land an assistant
        // append + a conversation touch.
        const lastCall =
          mockStreamLangyMastraResponse.mock.calls[
            mockStreamLangyMastraResponse.mock.calls.length - 1
          ]!;
        const onFinish = (lastCall[0] as { onFinish: (a: unknown) => Promise<void> })
          .onFinish;

        mockAppendMessage.mockClear();
        mockTouchConversation.mockClear();

        await onFinish({
          text: "ok",
          response: { messages: [{ role: "assistant", content: "ok" }] },
        });

        expect(mockAppendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            role: "assistant",
            projectId: "proj_demo",
          }),
        );
        expect(mockTouchConversation).toHaveBeenCalledWith(
          expect.objectContaining({ projectId: "proj_demo" }),
        );
      });
    });
  });
});
