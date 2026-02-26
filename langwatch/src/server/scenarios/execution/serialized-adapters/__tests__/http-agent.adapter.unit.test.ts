/**
 * @vitest-environment node
 */

import { AgentRole, type AgentInput } from "@langwatch/scenario";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpAgentData } from "../../types";
import { SerializedHttpAgentAdapter } from "../http-agent.adapter";

// Mock dependencies
vi.mock("~/utils/ssrfProtection", () => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("../../trace-context-headers", () => ({
  injectTraceContextHeaders: vi.fn(({ headers }: { headers: Record<string, string> }) => ({
    headers,
    traceId: undefined,
  })),
}));

import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { injectTraceContextHeaders } from "../../trace-context-headers";

const mockSsrfSafeFetch = vi.mocked(ssrfSafeFetch);
const mockInjectTraceContextHeaders = vi.mocked(injectTraceContextHeaders);

describe("SerializedHttpAgentAdapter", () => {
  const defaultConfig: HttpAgentData = {
    type: "http",
    agentId: "agent_123",
    url: "https://api.example.com/chat",
    method: "POST",
    headers: [],
    outputPath: "$.response",
  };

  const defaultInput: AgentInput = {
    threadId: "thread_123",
    messages: [{ role: "user", content: "Hello" }],
    newMessages: [{ role: "user", content: "Hello" }],
    requestedRole: AgentRole.AGENT,

    scenarioState: {} as AgentInput["scenarioState"],
    scenarioConfig: {} as AgentInput["scenarioConfig"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSsrfSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({ response: "API response" }),
      text: vi.fn().mockResolvedValue("API response"),
    } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);
  });

  it("has AGENT role", () => {
    const adapter = new SerializedHttpAgentAdapter(defaultConfig);
    expect(adapter.role).toBe(AgentRole.AGENT);
  });

  it("has correct name", () => {
    const adapter = new SerializedHttpAgentAdapter(defaultConfig);
    expect(adapter.name).toBe("SerializedHttpAgentAdapter");
  });

  it("makes HTTP request with correct URL and method", async () => {
    const adapter = new SerializedHttpAgentAdapter(defaultConfig);

    await adapter.call(defaultInput);

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "https://api.example.com/chat",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("includes Content-Type header", async () => {
    const adapter = new SerializedHttpAgentAdapter(defaultConfig);

    await adapter.call(defaultInput);

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("includes custom headers", async () => {
    const config: HttpAgentData = {
      ...defaultConfig,
      headers: [
        { key: "X-Custom-Header", value: "custom-value" },
        { key: "X-Another", value: "another-value" },
      ],
    };
    const adapter = new SerializedHttpAgentAdapter(config);

    await adapter.call(defaultInput);

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Custom-Header": "custom-value",
          "X-Another": "another-value",
        }),
      }),
    );
  });

  it("applies bearer authentication", async () => {
    const config: HttpAgentData = {
      ...defaultConfig,
      auth: { type: "bearer", token: "secret-token" },
    };
    const adapter = new SerializedHttpAgentAdapter(config);

    await adapter.call(defaultInput);

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
        }),
      }),
    );
  });

  it("applies api_key authentication", async () => {
    const config: HttpAgentData = {
      ...defaultConfig,
      auth: { type: "api_key", header: "X-API-Key", value: "my-key" },
    };
    const adapter = new SerializedHttpAgentAdapter(config);

    await adapter.call(defaultInput);

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-API-Key": "my-key",
        }),
      }),
    );
  });

  it("extracts response using JSONPath", async () => {
    const adapter = new SerializedHttpAgentAdapter(defaultConfig);

    const result = await adapter.call(defaultInput);

    expect(result).toBe("API response");
  });

  it("returns full response when outputPath not set", async () => {
    const config: HttpAgentData = {
      ...defaultConfig,
      outputPath: undefined,
    };
    mockSsrfSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({ data: "value" }),
    } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);

    const adapter = new SerializedHttpAgentAdapter(config);
    const result = await adapter.call(defaultInput);

    expect(result).toBe('{"data":"value"}');
  });

  it("throws on HTTP error", async () => {
    mockSsrfSafeFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);

    const adapter = new SerializedHttpAgentAdapter(defaultConfig);

    await expect(adapter.call(defaultInput)).rejects.toThrow(
      "HTTP 500: Internal Server Error",
    );
  });

  it("does not send body for GET requests", async () => {
    const config: HttpAgentData = { ...defaultConfig, method: "GET" };
    const adapter = new SerializedHttpAgentAdapter(config);

    await adapter.call(defaultInput);

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: undefined,
      }),
    );
  });

  describe("body templating", () => {
    it("replaces {{messages}} placeholder", async () => {
      const config: HttpAgentData = {
        ...defaultConfig,
        bodyTemplate: '{"messages": {{messages}}}',
      };
      const adapter = new SerializedHttpAgentAdapter(config);

      await adapter.call(defaultInput);

      const callArgs = mockSsrfSafeFetch.mock.calls[0]![1];
      const body = JSON.parse(callArgs?.body as string);
      expect(body.messages).toEqual([{ role: "user", content: "Hello" }]);
    });

    it("replaces {{threadId}} placeholder", async () => {
      const config: HttpAgentData = {
        ...defaultConfig,
        bodyTemplate: '{"thread": "{{threadId}}"}',
      };
      const adapter = new SerializedHttpAgentAdapter(config);

      await adapter.call(defaultInput);

      const callArgs = mockSsrfSafeFetch.mock.calls[0]![1];
      const body = JSON.parse(callArgs?.body as string);
      expect(body.thread).toBe("thread_123");
    });

    it("replaces {{input}} placeholder with last user message", async () => {
      const config: HttpAgentData = {
        ...defaultConfig,
        bodyTemplate: '{"input": "{{input}}"}',
      };
      const adapter = new SerializedHttpAgentAdapter(config);

      await adapter.call(defaultInput);

      const callArgs = mockSsrfSafeFetch.mock.calls[0]![1];
      const body = JSON.parse(callArgs?.body as string);
      expect(body.input).toBe("Hello");
    });

    describe("when body template contains Liquid conditions", () => {
      it("renders if/else based on input content", async () => {
        const config: HttpAgentData = {
          ...defaultConfig,
          bodyTemplate:
            '{"mode": "{% if input contains \'search\' %}search{% else %}chat{% endif %}", "query": "{{ input }}"}',
        };
        const adapter = new SerializedHttpAgentAdapter(config);

        const input: AgentInput = {
          ...defaultInput,
          messages: [{ role: "user", content: "search for cats" }],
          newMessages: [{ role: "user", content: "search for cats" }],
        };

        await adapter.call(input);

        const callArgs = mockSsrfSafeFetch.mock.calls[0]![1];
        const body = JSON.parse(callArgs?.body as string);
        expect(body.mode).toBe("search");
        expect(body.query).toBe("search for cats");
      });
    });
  });

  describe("trace ID capture", () => {
    it("exposes captured trace ID after a request", async () => {
      mockInjectTraceContextHeaders.mockImplementation(({ headers }) => ({
        headers,
        traceId: "captured_trace_id_123",
      }));

      const adapter = new SerializedHttpAgentAdapter(defaultConfig);
      await adapter.call(defaultInput);

      expect(adapter.getTraceId()).toBe("captured_trace_id_123");
    });

    it("returns undefined when no trace ID was captured", () => {
      const adapter = new SerializedHttpAgentAdapter(defaultConfig);
      expect(adapter.getTraceId()).toBeUndefined();
    });
  });

  describe("trace context injection", () => {
    it("calls injectTraceContextHeaders on each request", async () => {
      const adapter = new SerializedHttpAgentAdapter(defaultConfig);

      await adapter.call(defaultInput);

      expect(mockInjectTraceContextHeaders).toHaveBeenCalledWith({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        batchRunId: undefined,
      });
    });

    describe("when constructed with batchRunId", () => {
      it("passes batchRunId to injectTraceContextHeaders", async () => {
        const adapter = new SerializedHttpAgentAdapter({
          config: defaultConfig,
          batchRunId: "batch_abc123",
        });

        await adapter.call(defaultInput);

        expect(mockInjectTraceContextHeaders).toHaveBeenCalledWith({
          headers: expect.any(Object),
          batchRunId: "batch_abc123",
        });
      });
    });

    describe("when custom headers are configured", () => {
      it("calls injection after custom headers are applied", async () => {
        const config: HttpAgentData = {
          ...defaultConfig,
          headers: [{ key: "X-Custom", value: "custom-value" }],
        };
        const adapter = new SerializedHttpAgentAdapter({
          config,
          batchRunId: "batch_xyz",
        });

        await adapter.call(defaultInput);

        expect(mockInjectTraceContextHeaders).toHaveBeenCalledWith({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Custom": "custom-value",
          }),
          batchRunId: "batch_xyz",
        });
      });
    });
  });
});
