/**
 * @vitest-environment node
 */

import scenario, { AgentRole, type AgentAdapter } from "@langwatch/scenario";
import { MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream } from "ai/test";
import { describe, expect, it, vi, beforeEach } from "vitest";

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

vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) => mockGetServerAuthSession(...args),
}));

vi.mock("~/server/api/rbac", () => ({
  hasProjectPermission: (...args: unknown[]) => mockHasProjectPermission(...args),
}));

vi.mock("~/server/middleware/rate-limit-langy", () => ({
  LANGY_TOOL_CALLS_PER_MESSAGE: 5,
  checkLangyMessageRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
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

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: {
    isEnabled: (...args: unknown[]) => mockFeatureFlagIsEnabled(...args),
  },
}));

vi.mock("~/server/services/langy/mastra-agent", () => ({
  streamLangyMastraResponse: vi.fn(),
}));

vi.mock("~/server/services/langy", () => ({
  LangyConversationService: {
    create: () => ({
      ensureConversation: (...args: unknown[]) => mockEnsureConversation(...args),
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

function makeStubModel(text: string) {
  const chunks = [
    { type: "stream-start", warnings: [] },
    { type: "response-metadata", id: "rsp-1", modelId: "mock-1" },
    { type: "text-start", id: "txt-1" },
    { type: "text-delta", id: "txt-1", delta: text },
    { type: "text-end", id: "txt-1" },
    {
      type: "finish",
      finishReason: "stop" as const,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    },
  ];
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks,
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }) as never,
    }),
  });
}

async function readBody(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value);
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerAuthSession.mockResolvedValue({ user: { id: "u_1" } });
  mockHasProjectPermission.mockResolvedValue(true);
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockEnsureConversation.mockResolvedValue({ id: "conv_test_abc" });
  mockTouchConversation.mockResolvedValue(undefined);
  mockGetProjectMemory.mockResolvedValue(null);
  mockGetUserPrefs.mockResolvedValue({ mode: "non_expert" });
  mockAppendMessage.mockResolvedValue(undefined);
  mockFeatureFlagIsEnabled.mockResolvedValue(false);
  mockGetVercelAIModel.mockResolvedValue(makeStubModel("Langy says hello."));
});

function toUiMessages(messages: Array<{ role: string; content: unknown }>) {
  return messages.map((m, i) => ({
    id: `m_${i + 1}`,
    role: m.role,
    parts: [{ type: "text", text: String(m.content ?? "") }],
  }));
}

describe("Langy Scenario DSL coverage", () => {
  async function assertLangyStreamingForPrompt(prompt: string) {
    const langyAdapter: AgentAdapter = {
      role: AgentRole.AGENT,
      call: async () => {
        const res = await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: "project_1",
            messages: toUiMessages([{ role: "user", content: prompt }]),
          }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
        expect(res.headers.get("x-langy-conversation-id")).toBeTruthy();
        const body = await readBody(res);
        expect(body).toContain("data:");
        return "ok";
      },
    };

    const result = await scenario.run({
      id: `langy-persona-${prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`,
      setId: "langy-workbench-personas",
      name: "Langy persona streaming coverage",
      description: `Persona prompt coverage: ${prompt}`,
      agents: [langyAdapter, scenario.userSimulatorAgent()],
      script: [scenario.user(prompt), scenario.agent(), scenario.succeed()],
    });
    expect(result.success).toBe(true);
  }

  it("runs a first-turn scenario against /api/langy/chat", async () => {
    /** @scenario First user message starts a streaming Langy conversation */
    const langyAdapter: AgentAdapter = {
      role: AgentRole.AGENT,
      call: async (input) => {
        const res = await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: "project_1",
            messages: toUiMessages(input.messages),
          }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
        expect(res.headers.get("x-langy-conversation-id")).toBeTruthy();
        const body = await readBody(res);
        expect(body).toContain("data:");
        return "Streaming response received";
      },
    };

    const result = await scenario.run({
      id: "langy-first-turn",
      setId: "langy-chat-api",
      name: "Langy first turn streams",
      description: "First user message should stream and create conversation id.",
      agents: [langyAdapter, scenario.userSimulatorAgent()],
      script: [
        scenario.user("What evaluators are available?"),
        scenario.agent(),
        scenario.succeed("Langy streamed and returned a conversation id."),
      ],
    });

    expect(result.success).toBe(true);
  });

  it("runs a follow-up scenario reusing conversation id", async () => {
    /** @scenario Follow-up user message continues the same Langy conversation */
    const langyAdapter: AgentAdapter = {
      role: AgentRole.AGENT,
      call: async (input) => {
        const first = await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: "project_1",
            messages: toUiMessages([{ role: "user", content: "List evaluators." }]),
          }),
        });
        expect(first.status).toBe(200);
        const convId = first.headers.get("x-langy-conversation-id");
        expect(convId).toBeTruthy();
        await readBody(first);

        const second = await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: "project_1",
            conversationId: convId,
            messages: toUiMessages(input.messages),
          }),
        });
        expect(second.status).toBe(200);
        expect(second.headers.get("x-langy-conversation-id")).toBe(convId);
        const body = await readBody(second);
        expect(body).toContain("data:");
        return "Conversation continuity verified";
      },
    };

    const result = await scenario.run({
      id: "langy-follow-up-turn",
      setId: "langy-chat-api",
      name: "Langy follow-up keeps conversation id",
      description: "Follow-up message should continue the same conversation.",
      agents: [langyAdapter, scenario.userSimulatorAgent()],
      script: [
        scenario.user("Explain the first evaluator."),
        scenario.agent(),
        scenario.succeed("Langy reused the same conversation id."),
      ],
    });

    expect(result.success).toBe(true);
  });

  it("covers non_expert persona end-to-end", async () => {
    /** @scenario Non-expert user with evaluation access can use Langy */
    mockHasProjectPermission.mockResolvedValue(true);
    mockGetUserPrefs.mockResolvedValue({ mode: "non_expert" });

    const langyAdapter: AgentAdapter = {
      role: AgentRole.AGENT,
      call: async (input) => {
        const res = await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: "project_1",
            messages: toUiMessages(input.messages),
          }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
        expect(res.headers.get("x-langy-conversation-id")).toBeTruthy();
        const body = await readBody(res);
        expect(body).toContain("data:");
        return "ok";
      },
    };

    const result = await scenario.run({
      id: "langy-persona-non-expert",
      setId: "langy-personas",
      name: "Langy non-expert persona",
      description: "Non-expert user with evaluations:view gets normal streaming chat.",
      agents: [langyAdapter, scenario.userSimulatorAgent()],
      script: [scenario.user("Help me pick an evaluator."), scenario.agent(), scenario.succeed()],
    });

    expect(result.success).toBe(true);
  });

  it("covers expert persona end-to-end", async () => {
    /** @scenario Expert user with evaluation access can use Langy */
    mockHasProjectPermission.mockResolvedValue(true);
    mockGetUserPrefs.mockResolvedValue({ mode: "expert" });

    const langyAdapter: AgentAdapter = {
      role: AgentRole.AGENT,
      call: async (input) => {
        const res = await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: "project_1",
            messages: toUiMessages(input.messages),
          }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
        expect(res.headers.get("x-langy-conversation-id")).toBeTruthy();
        const body = await readBody(res);
        expect(body).toContain("data:");
        return "ok";
      },
    };

    const result = await scenario.run({
      id: "langy-persona-expert",
      setId: "langy-personas",
      name: "Langy expert persona",
      description: "Expert user with evaluations:view gets normal streaming chat.",
      agents: [langyAdapter, scenario.userSimulatorAgent()],
      script: [scenario.user("Give me a detailed evaluator plan."), scenario.agent(), scenario.succeed()],
    });

    expect(result.success).toBe(true);
  });

  it("covers unauthorized persona end-to-end", async () => {
    /** @scenario User without evaluation access is blocked from Langy */
    mockHasProjectPermission.mockResolvedValue(false);

    const langyAdapter: AgentAdapter = {
      role: AgentRole.AGENT,
      call: async (input) => {
        const res = await app.request("/api/langy/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: "project_1",
            messages: toUiMessages(input.messages),
          }),
        });
        expect(res.status).toBe(403);
        expect(res.headers.get("content-type") ?? "").toContain("application/json");
        const body = await res.json();
        expect(String((body as { error?: string }).error ?? "")).toContain("permission");
        return "blocked";
      },
    };

    const result = await scenario.run({
      id: "langy-persona-no-permission",
      setId: "langy-personas",
      name: "Langy unauthorized persona",
      description: "User without evaluations:view must be blocked.",
      agents: [langyAdapter, scenario.userSimulatorAgent()],
      script: [scenario.user("List evaluators in this project."), scenario.agent(), scenario.succeed()],
    });

    expect(result.success).toBe(true);
  });

  it("covers PM persona prompt", async () => {
    /** @scenario PM persona asks for high-level evaluator guidance */
    await assertLangyStreamingForPrompt(
      "Which evaluators should I use to track product quality this week?",
    );
  });

  it("covers engineer persona prompt", async () => {
    /** @scenario Engineer persona asks for technical evaluator details */
    await assertLangyStreamingForPrompt(
      "Explain how Answer Relevancy works and what inputs it needs",
    );
  });

  it("covers general teammate persona prompt", async () => {
    /** @scenario General teammate persona asks for next-step help */
    await assertLangyStreamingForPrompt(
      "What should I run first to evaluate this experiment?",
    );
  });
});
