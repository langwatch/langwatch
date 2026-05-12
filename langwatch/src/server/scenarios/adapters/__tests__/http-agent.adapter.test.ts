import { type AgentInput, AgentRole } from "@langwatch/scenario";
import { Response } from "undici";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpComponentConfig } from "~/optimization_studio/types/dsl";
import type {
  AgentRepository,
  TypedAgent,
} from "../../../agents/agent.repository";
import { TemplateRenderError } from "../../execution/http-template-engine";
import { HttpAgentAdapter } from "../http-agent.adapter";

const createAgentInput = (
  messages: Array<{ role: string; content: string }>,
  overrides: Partial<AgentInput> = {},
): AgentInput =>
  ({
    threadId: "test-thread-id",
    messages,
    newMessages: messages,
    requestedRole: AgentRole.AGENT,
    judgmentRequest: false,
    scenarioState: {} as AgentInput["scenarioState"],
    scenarioConfig: {} as AgentInput["scenarioConfig"],
    ...overrides,
  }) as AgentInput;

const createMockAgentRepository = (agent: TypedAgent | null = null) =>
  ({
    findById: vi.fn().mockResolvedValue(agent),
  }) as unknown as AgentRepository;

const createHttpAgent = (
  configOverrides: Partial<HttpComponentConfig> = {},
): TypedAgent =>
  ({
    id: "agent-123",
    projectId: "project-123",
    name: "Test HTTP Agent",
    type: "http",
    config: {
      name: "HTTP",
      url: "https://api.example.com/chat",
      method: "POST",
      ...configOverrides,
    } as HttpComponentConfig,
  }) as TypedAgent;

// Mock ssrfSafeFetch
vi.mock("~/utils/ssrfProtection", () => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("../../execution/trace-context-headers", () => ({
  injectTraceContextHeaders: vi.fn(({ headers }: { headers: Record<string, string> }) => ({
    headers,
    traceId: undefined,
  })),
}));

import { injectTraceContextHeaders } from "../../execution/trace-context-headers";
const mockInjectTraceContextHeaders = vi.mocked(injectTraceContextHeaders);

describe("HttpAgentAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when agent is not found", () => {
    it("throws an error", async () => {
      const repository = createMockAgentRepository(null);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      await expect(adapter.call(createAgentInput([]))).rejects.toThrow(
        "HTTP agent agent-123 not found",
      );
    });
  });

  describe("when agent is not HTTP type", () => {
    it("throws an error", async () => {
      const agent = {
        ...createHttpAgent(),
        type: "signature",
      } as TypedAgent;
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      await expect(adapter.call(createAgentInput([]))).rejects.toThrow(
        "Agent agent-123 is not an HTTP agent (type: signature)",
      );
    });
  });

  describe("authentication", () => {
    it("adds Bearer token header when auth type is bearer", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const agent = createHttpAgent({
        auth: { type: "bearer", token: "my-secret-token" },
      });
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      await adapter.call(
        createAgentInput([{ role: "user", content: "Hello" }]),
      );

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs?.[1]?.headers as Record<string, string>;
      expect(headers?.Authorization).toBe("Bearer my-secret-token");
    });

    it("adds custom header when auth type is api_key", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const agent = createHttpAgent({
        auth: { type: "api_key", header: "X-API-Key", value: "my-api-key" },
      });
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      await adapter.call(
        createAgentInput([{ role: "user", content: "Hello" }]),
      );

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs?.[1]?.headers as Record<string, string>;
      expect(headers?.["X-API-Key"]).toBe("my-api-key");
    });

    it("adds Basic auth header when auth type is basic", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const agent = createHttpAgent({
        auth: { type: "basic", username: "user", password: "pass" },
      });
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      await adapter.call(
        createAgentInput([{ role: "user", content: "Hello" }]),
      );

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs?.[1]?.headers as Record<string, string>;
      const expectedAuth = `Basic ${Buffer.from("user:pass").toString("base64")}`;
      expect(headers?.Authorization).toBe(expectedAuth);
    });

    it("adds no auth header when auth type is none", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const agent = createHttpAgent({
        auth: { type: "none" },
      });
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      await adapter.call(
        createAgentInput([{ role: "user", content: "Hello" }]),
      );

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs?.[1]?.headers as Record<string, string>;
      expect(headers?.Authorization).toBeUndefined();
    });
  });

  describe("request body templating", () => {
    it("replaces {{messages}} with JSON messages array", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const agent = createHttpAgent({
        bodyTemplate: '{"messages": {{messages}}}',
      });
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      const messages = [{ role: "user", content: "Hello" }];
      await adapter.call(createAgentInput(messages));

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs?.[1]?.body as string);
      expect(body.messages).toEqual(messages);
    });

    it("replaces {{threadId}} with thread ID", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const agent = createHttpAgent({
        bodyTemplate: '{"thread": "{{threadId}}"}',
      });
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      await adapter.call(
        createAgentInput([{ role: "user", content: "Hello" }], {
          threadId: "my-thread-123",
        }),
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs?.[1]?.body as string);
      expect(body.thread).toBe("my-thread-123");
    });

    it("replaces {{input}} with last user message content", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const agent = createHttpAgent({
        bodyTemplate: '{"input": "{{input}}"}',
      });
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      await adapter.call(
        createAgentInput([
          { role: "user", content: "First message" },
          { role: "assistant", content: "Response" },
          { role: "user", content: "Last user message" },
        ]),
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs?.[1]?.body as string);
      expect(body.input).toBe("Last user message");
    });

    it("extracts last user message even when assistant message comes after", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const agent = createHttpAgent({
        bodyTemplate: '{"input": "{{input}}"}',
      });
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      await adapter.call(
        createAgentInput([
          { role: "user", content: "User question" },
          {
            role: "assistant",
            content: "This is the last message but not user",
          },
        ]),
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs?.[1]?.body as string);
      expect(body.input).toBe("User question");
    });

    it("renders {{input}} as empty string when messages array is empty", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const agent = createHttpAgent({
        bodyTemplate: '{"input": "{{input}}"}',
      });
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      await adapter.call(createAgentInput([]));

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs?.[1]?.body as string);
      expect(body.input).toBe("");
    });

    it("renders {{input}} as empty string when no user messages exist", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const agent = createHttpAgent({
        bodyTemplate: '{"input": "{{input}}"}',
      });
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      await adapter.call(
        createAgentInput([
          { role: "assistant", content: "Only assistant messages" },
          { role: "system", content: "System message" },
        ]),
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs?.[1]?.body as string);
      expect(body.input).toBe("");
    });

    it("stringifies non-string content for {{input}}", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const agent = createHttpAgent({
        bodyTemplate: '{"input": {{input}}}',
      });
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      const structuredContent = [{ type: "text", text: "Hello world" }];
      await adapter.call(
        createAgentInput([
          { role: "user", content: structuredContent as unknown as string },
        ]),
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs?.[1]?.body as string);
      expect(body.input).toEqual(structuredContent);
    });

    it("uses default body when template is undefined", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const agent = createHttpAgent({
        bodyTemplate: undefined,
      });
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      const messages = [{ role: "user", content: "Hello" }];
      await adapter.call(createAgentInput(messages));

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs?.[1]?.body as string);
      expect(body).toEqual({ messages });
    });
  });

  describe("response extraction", () => {
    it("extracts value using JSONPath when outputPath is configured", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Extracted content" } }],
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );

      const agent = createHttpAgent({
        outputPath: "$.choices[0].message.content",
      });
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      const result = await adapter.call(
        createAgentInput([{ role: "user", content: "Hello" }]),
      );

      expect(result).toBe("Extracted content");
    });

    it("returns full response when JSONPath finds no matches", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      const responseData = { different: { structure: "value" } };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(responseData), {
          headers: { "content-type": "application/json" },
        }),
      );

      const agent = createHttpAgent({
        outputPath: "$.nonexistent.path",
      });
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      const result = await adapter.call(
        createAgentInput([{ role: "user", content: "Hello" }]),
      );

      expect(result).toBe(JSON.stringify(responseData));
    });

    it("returns full response when outputPath is empty", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      const responseData = { result: "full response" };
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(responseData), {
          headers: { "content-type": "application/json" },
        }),
      );

      const agent = createHttpAgent({
        outputPath: "",
      });
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      const result = await adapter.call(
        createAgentInput([{ role: "user", content: "Hello" }]),
      );

      expect(result).toBe(JSON.stringify(responseData));
    });

    it("handles non-JSON responses", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response("Plain text response", {
          headers: { "content-type": "text/plain" },
        }),
      );

      const agent = createHttpAgent();
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      const result = await adapter.call(
        createAgentInput([{ role: "user", content: "Hello" }]),
      );

      expect(result).toBe("Plain text response");
    });
  });

  describe("HTTP errors", () => {
    it("throws descriptive error on non-2xx response", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response("Not Found", {
          status: 404,
          statusText: "Not Found",
        }),
      );

      const agent = createHttpAgent();
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      await expect(
        adapter.call(createAgentInput([{ role: "user", content: "Hello" }])),
      ).rejects.toThrow("HTTP 404: Not Found");
    });
  });

  describe("custom headers", () => {
    it("applies custom headers from config", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const agent = createHttpAgent({
        headers: [
          { key: "X-Custom-Header", value: "custom-value" },
          { key: "X-Another", value: "another-value" },
        ],
      });
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      await adapter.call(
        createAgentInput([{ role: "user", content: "Hello" }]),
      );

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs?.[1]?.headers as Record<string, string>;
      expect(headers?.["X-Custom-Header"]).toBe("custom-value");
      expect(headers?.["X-Another"]).toBe("another-value");
    });

    it("trims whitespace from header keys", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const agent = createHttpAgent({
        headers: [{ key: "  X-Trimmed  ", value: "value" }],
      });
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      await adapter.call(
        createAgentInput([{ role: "user", content: "Hello" }]),
      );

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs?.[1]?.headers as Record<string, string>;
      expect(headers?.["X-Trimmed"]).toBe("value");
    });
  });

  describe("trace context injection", () => {
    it("calls injectTraceContextHeaders in buildRequestHeaders", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          headers: { "content-type": "application/json" },
        }),
      );

      const agent = createHttpAgent();
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      await adapter.call(
        createAgentInput([{ role: "user", content: "Hello" }]),
      );

      expect(mockInjectTraceContextHeaders).toHaveBeenCalledWith({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      });
    });

    describe("when custom headers are configured", () => {
      it("preserves custom headers alongside trace context injection", async () => {
        const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
        const mockFetch = vi.mocked(ssrfSafeFetch);
        mockFetch.mockResolvedValue(
          new Response(JSON.stringify({ result: "ok" }), {
            headers: { "content-type": "application/json" },
          }),
        );

        const agent = createHttpAgent({
          headers: [{ key: "X-Custom", value: "custom-value" }],
        });
        const repository = createMockAgentRepository(agent);
        const adapter = new HttpAgentAdapter({
          agentId: "agent-123",
          projectId: "project-123",
          agentRepository: repository,
        });

        await adapter.call(
          createAgentInput([{ role: "user", content: "Hello" }]),
        );

        expect(mockInjectTraceContextHeaders).toHaveBeenCalledWith({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Custom": "custom-value",
          }),
        });
      });
    });
  });

  describe("trace ID capture", () => {
    it("exposes captured trace ID after a request", async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          headers: { "content-type": "application/json" },
        }),
      );

      mockInjectTraceContextHeaders.mockImplementation(({ headers }) => ({
        headers,
        traceId: "captured_trace_id_abc",
      }));

      const agent = createHttpAgent();
      const repository = createMockAgentRepository(agent);
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: repository,
      });

      await adapter.call(
        createAgentInput([{ role: "user", content: "Hello" }]),
      );

      expect(adapter.getTraceId()).toBe("captured_trace_id_abc");
    });

    it("returns undefined when no trace ID was captured", () => {
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: createMockAgentRepository(),
      });

      expect(adapter.getTraceId()).toBeUndefined();
    });
  });

  describe("URL template interpolation", () => {
    const setupMockFetch = async () => {
      const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
      const mockFetch = vi.mocked(ssrfSafeFetch);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ result: "ok" }), {
          headers: { "content-type": "application/json" },
        }),
      );
      return mockFetch;
    };

    it("renders {{threadId}} in url via Liquid", async () => {
      const mockFetch = await setupMockFetch();
      const agent = createHttpAgent({
        url: "https://api.example.com/conversations/{{threadId}}/messages",
      });
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: createMockAgentRepository(agent),
      });

      await adapter.call(
        createAgentInput([{ role: "user", content: "Hello" }], {
          threadId: "thread-abc-123",
        }),
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/conversations/thread-abc-123/messages",
        expect.any(Object),
      );
    });

    it("URL-encodes interpolated values by default", async () => {
      const mockFetch = await setupMockFetch();
      const agent = createHttpAgent({
        url: "https://api.example.com/search/{{input}}",
      });
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: createMockAgentRepository(agent),
      });

      await adapter.call(
        createAgentInput([
          { role: "user", content: "hello world & friends?" },
        ]),
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/search/hello%20world%20%26%20friends%3F",
        expect.any(Object),
      );
    });

    it("preserves url literals (slashes) around interpolated values", async () => {
      const mockFetch = await setupMockFetch();
      const agent = createHttpAgent({
        url: "https://api.example.com/conversations/{{threadId}}/messages",
      });
      const adapter = new HttpAgentAdapter({
        agentId: "agent-123",
        projectId: "project-123",
        agentRepository: createMockAgentRepository(agent),
      });

      await adapter.call(
        createAgentInput([{ role: "user", content: "Hello" }], {
          threadId: "abc",
        }),
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/conversations/abc/messages",
        expect.any(Object),
      );
    });

    describe("when using `| raw` escape hatch", () => {
      it("skips URL-encoding for raw-filtered references only", async () => {
        const mockFetch = await setupMockFetch();
        const agent = createHttpAgent({
          url: "https://api.example.com/{{threadId | raw}}/s/{{input}}",
        });
        const adapter = new HttpAgentAdapter({
          agentId: "agent-123",
          projectId: "project-123",
          agentRepository: createMockAgentRepository(agent),
        });

        await adapter.call(
          createAgentInput([{ role: "user", content: "with space" }], {
            threadId: "path/with/slashes",
          }),
        );

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.example.com/path/with/slashes/s/with%20space",
          expect.any(Object),
        );
      });
    });

    describe("when url has no interpolation placeholders", () => {
      it("passes url through unchanged", async () => {
        const mockFetch = await setupMockFetch();
        const agent = createHttpAgent({
          url: "https://api.example.com/chat",
        });
        const adapter = new HttpAgentAdapter({
          agentId: "agent-123",
          projectId: "project-123",
          agentRepository: createMockAgentRepository(agent),
        });

        await adapter.call(
          createAgentInput([{ role: "user", content: "Hello" }]),
        );

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.example.com/chat",
          expect.any(Object),
        );
      });
    });

    describe("when url contains Liquid conditional", () => {
      it("renders if-branch when condition is truthy", async () => {
        const mockFetch = await setupMockFetch();
        const agent = createHttpAgent({
          url: "https://api.example.com{% if conversationId %}/chat/{{conversationId}}/message{% else %}/chat/start{% endif %}",
          scenarioMappings: {
            conversationId: { type: "value", value: "conv-42" },
          },
        });
        const adapter = new HttpAgentAdapter({
          agentId: "agent-123",
          projectId: "project-123",
          agentRepository: createMockAgentRepository(agent),
        });

        await adapter.call(
          createAgentInput([{ role: "user", content: "Hi" }]),
        );

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.example.com/chat/conv-42/message",
          expect.any(Object),
        );
      });

      it("renders else-branch when condition is falsy", async () => {
        const mockFetch = await setupMockFetch();
        const agent = createHttpAgent({
          url: "https://api.example.com{% if conversationId %}/chat/{{conversationId}}/message{% else %}/chat/start{% endif %}",
        });
        const adapter = new HttpAgentAdapter({
          agentId: "agent-123",
          projectId: "project-123",
          agentRepository: createMockAgentRepository(agent),
        });

        await adapter.call(
          createAgentInput([{ role: "user", content: "Hi" }]),
        );

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.example.com/chat/start",
          expect.any(Object),
        );
      });
    });

    describe("SSRF regression", () => {
      const setupSsrfMock = async () => {
        const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
        const mockFetch = vi.mocked(ssrfSafeFetch);
        mockFetch.mockRejectedValue(new Error("Access to private IP denied"));
        return mockFetch;
      };

      it("passes resolved url (not template) to ssrfSafeFetch", async () => {
        const mockFetch = await setupSsrfMock();
        const agent = createHttpAgent({
          url: "https://{{input | raw}}/metadata",
        });
        const adapter = new HttpAgentAdapter({
          agentId: "agent-123",
          projectId: "project-123",
          agentRepository: createMockAgentRepository(agent),
        });

        await expect(
          adapter.call(
            createAgentInput([{ role: "user", content: "127.0.0.1" }]),
          ),
        ).rejects.toThrow("Access to private IP denied");

        expect(mockFetch).toHaveBeenCalledWith(
          "https://127.0.0.1/metadata",
          expect.any(Object),
        );
      });

      it.each([
        ["localhost", "localhost"],
        ["127.0.0.1", "127.0.0.1"],
        ["169.254.169.254", "169.254.169.254"],
      ])(
        "passes %s-resolved url to ssrfSafeFetch so it can be rejected",
        async (label, ip) => {
          const mockFetch = await setupSsrfMock();
          const agent = createHttpAgent({
            url: "https://{{input | raw}}/path",
          });
          const adapter = new HttpAgentAdapter({
            agentId: "agent-123",
            projectId: "project-123",
            agentRepository: createMockAgentRepository(agent),
          });

          await expect(
            adapter.call(createAgentInput([{ role: "user", content: ip }])),
          ).rejects.toThrow();

          expect(mockFetch).toHaveBeenCalledWith(
            `https://${ip}/path`,
            expect.any(Object),
          );
          expect(label).toBeTruthy();
        },
      );
    });

    describe("when url template is malformed", () => {
      it("throws TemplateRenderError with field=url", async () => {
        await setupMockFetch();
        const agent = createHttpAgent({
          url: "https://api.example.com/{% if %}/broken",
        });
        const adapter = new HttpAgentAdapter({
          agentId: "agent-123",
          projectId: "project-123",
          agentRepository: createMockAgentRepository(agent),
        });

        await expect(
          adapter.call(
            createAgentInput([{ role: "user", content: "Hello" }]),
          ),
        ).rejects.toThrow(TemplateRenderError);

        await expect(
          adapter.call(
            createAgentInput([{ role: "user", content: "Hello" }]),
          ),
        ).rejects.toMatchObject({ field: "url" });
      });
    });
  });
});
