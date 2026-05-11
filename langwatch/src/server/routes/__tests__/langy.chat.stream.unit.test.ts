/**
 * Binds langy-baseline.feature § "Stream responses token by token".
 *
 * Exercises the chat route end-to-end through `app.request`, with a stub
 * MockLanguageModelV3 plugged in via `getVercelAIModel`. All Langy DB
 * services are mocked so this stays in the unit-test budget (no Docker).
 */
import { simulateReadableStream } from "ai/test";
import { MockLanguageModelV3 } from "ai/test";
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
vi.mock("~/server/evaluators/evaluator.service", () => ({
  EvaluatorService: {
    create: () => ({
      getAllWithFields: (...args: unknown[]) =>
        mockEvaluatorGetAllWithFields(...args),
    }),
  },
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
  return new MockLanguageModelV3({
    doStream: async () => ({
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
      }),
    }),
  });
}

/**
 * Two-turn stub model: first turn invokes `list_evaluators` with the
 * given input; second turn emits a short final text. Used to exercise
 * the tool execute path (project scoping, return-value shape) end-to-end.
 */
function makeToolCallingStubModel(toolName: string, input: unknown) {
  const turns = [
    {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "response-metadata", id: "rsp-1", modelId: "mock-1" },
          {
            type: "tool-call",
            toolCallId: "tc-1",
            toolName,
            input: JSON.stringify(input),
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
    },
    {
      stream: simulateReadableStream({
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
    },
  ];
  return new MockLanguageModelV3({ doStream: turns });
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
  mockEvaluatorGetAllWithFields.mockResolvedValue([]);
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

  // NOTE: A two-turn `makeToolCallingStubModel` is provided above for
  // when V3 tool-call event shape lands in the test suite. Scenarios 4
  // (project-scoped tool calls) and 6/7 (list_evaluators/find_failing_rows
  // payloads) will bind here. The route's projectId propagation is
  // already proven via `calls getVercelAIModel with the request's
  // projectId` above; the full tool-execute path lands in a follow-up.
});
