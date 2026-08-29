/**
 * @vitest-environment node
 */

import { type AgentInput, AgentRole } from "@langwatch/scenario";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TemplateRenderError } from "@langwatch/scenario-contract";
import type { HttpAgentData } from "@langwatch/scenario-contract";
import {
  createMockHttpAgentAdapter,
  mockScenarioHttpFetch,
} from "../support/test-scenario-http.port";

vi.mock("@langwatch/observability/tracing", () => ({
  injectTraceContextHeaders: vi.fn(
    ({ headers }: { headers: Record<string, string> }) => ({
      headers,
      traceId: undefined,
    }),
  ),
}));

import { injectTraceContextHeaders } from "@langwatch/observability/tracing";

const mockSsrfSafeFetch = mockScenarioHttpFetch;
const mockInjectTraceContextHeaders = vi.mocked(injectTraceContextHeaders);

describe("SerializedHttpAgentAdapter", () => {
  const defaultConfig: HttpAgentData = {
    type: "http",
    agentId: "agent_123",
    url: "https://api.example.com/chat",
    method: "POST",
    headers: [],
    secrets: {},
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
    // clearAllMocks keeps implementations, so pin the no-active-context
    // default here; tests that need a trace context override it themselves.
    mockInjectTraceContextHeaders.mockImplementation(({ headers }) => ({
      headers,
      traceId: undefined,
    }));
    mockSsrfSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({ response: "API response" }),
      text: vi.fn().mockResolvedValue("API response"),
    });
  });

  it("has AGENT role", () => {
    const adapter = createMockHttpAgentAdapter({ config: defaultConfig });
    expect(adapter.role).toBe(AgentRole.AGENT);
  });

  it("reports the adapter name", () => {
    const adapter = createMockHttpAgentAdapter({ config: defaultConfig });
    expect(adapter.name).toBe("SerializedHttpAgentAdapter");
  });

  it("makes HTTP request with correct URL and method", async () => {
    const adapter = createMockHttpAgentAdapter({ config: defaultConfig });

    await adapter.call(defaultInput);

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "https://api.example.com/chat",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("includes Content-Type header", async () => {
    const adapter = createMockHttpAgentAdapter({ config: defaultConfig });

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
    const adapter = createMockHttpAgentAdapter({ config });

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
    const adapter = createMockHttpAgentAdapter({ config });

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
    const adapter = createMockHttpAgentAdapter({ config });

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
    const adapter = createMockHttpAgentAdapter({ config: defaultConfig });

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
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({ data: "value" }),
      text: vi.fn().mockResolvedValue('{"data":"value"}'),
    });

    const adapter = createMockHttpAgentAdapter({ config });
    const result = await adapter.call(defaultInput);

    expect(result).toBe('{"data":"value"}');
  });

  it("throws on HTTP error", async () => {
    mockSsrfSafeFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
      json: vi.fn(),
      text: vi.fn().mockResolvedValue(""),
    });

    const adapter = createMockHttpAgentAdapter({ config: defaultConfig });

    await expect(adapter.call(defaultInput)).rejects.toThrow(
      "HTTP 500: Internal Server Error",
    );
  });

  it("does not send body for GET requests", async () => {
    const config: HttpAgentData = { ...defaultConfig, method: "GET" };
    const adapter = createMockHttpAgentAdapter({ config });

    await adapter.call(defaultInput);

    const request = mockSsrfSafeFetch.mock.calls[0]?.[1];
    expect(request).not.toHaveProperty("body");
  });

  describe("body templating", () => {
    it("replaces {{messages}} placeholder", async () => {
      const config: HttpAgentData = {
        ...defaultConfig,
        bodyTemplate: '{"messages": {{messages}}}',
      };
      const adapter = createMockHttpAgentAdapter({ config });

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
      const adapter = createMockHttpAgentAdapter({ config });

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
      const adapter = createMockHttpAgentAdapter({ config });

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
        const adapter = createMockHttpAgentAdapter({ config });

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

  describe("when scenarioMappings are on the agent config", () => {
    /** @scenario HTTP agent adapter uses resolved fieldMappings for template variables */
    it("merges resolved mappings into the template context, overriding defaults", async () => {
      const config: HttpAgentData = {
        ...defaultConfig,
        bodyTemplate: '{"query": "{{query}}", "history": {{context}}}',
        scenarioMappings: {
          query: { type: "source", sourceId: "scenario", path: ["input"] },
          context: { type: "source", sourceId: "scenario", path: ["messages"] },
        },
      };
      const adapter = createMockHttpAgentAdapter({ config });

      await adapter.call(defaultInput);

      const callArgs = mockSsrfSafeFetch.mock.calls[0]![1];
      const body = JSON.parse(callArgs?.body as string);
      expect(body.query).toBe("Hello");
      expect(body.history).toEqual([{ role: "user", content: "Hello" }]);
    });
  });

  describe("when no scenarioMappings are on the agent config", () => {
    /** @scenario HTTP agent adapter falls back to legacy behavior without mappings */
    it("falls back to legacy template context with input, messages, threadId", async () => {
      const config: HttpAgentData = {
        ...defaultConfig,
        bodyTemplate: '{"input": "{{input}}", "messages": {{messages}}}',
      };
      const adapter = createMockHttpAgentAdapter({ config });

      await adapter.call(defaultInput);

      const callArgs = mockSsrfSafeFetch.mock.calls[0]![1];
      const body = JSON.parse(callArgs?.body as string);
      expect(body.input).toBe("Hello");
      expect(body.messages).toEqual([{ role: "user", content: "Hello" }]);
    });
  });

  describe("trace context propagation", () => {
    const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
    const TRACEPARENT = `00-${TRACE_ID}-b7ad6b7169203331-01`;

    const injectTraceContext = () => {
      mockInjectTraceContextHeaders.mockImplementation(({ headers }) => {
        headers.traceparent = TRACEPARENT;
        headers.tracestate = "vendor=1";
        return { headers, traceId: TRACE_ID };
      });
    };

    const sentHeaders = (): Record<string, string> =>
      (
        mockSsrfSafeFetch.mock.calls[0]![1] as {
          headers: Record<string, string>;
        }
      ).headers;

    it("captures the propagation once per call and sends its headers", async () => {
      injectTraceContext();
      const adapter = createMockHttpAgentAdapter({ config: defaultConfig });

      await adapter.call(defaultInput);

      expect(mockInjectTraceContextHeaders).toHaveBeenCalledTimes(1);
      expect(sentHeaders().traceparent).toBe(TRACEPARENT);
      expect(sentHeaders().tracestate).toBe("vendor=1");
    });

    describe("when the target configures its own traceparent header", () => {
      /** @scenario "The automatic traceparent does not replace one the target configured" */
      it("keeps the configured value, whatever its casing", async () => {
        injectTraceContext();
        const config: HttpAgentData = {
          ...defaultConfig,
          headers: [
            {
              key: "Traceparent",
              value: "00-{{ traceId }}-0000000000000001-01",
            },
          ],
        };
        const adapter = createMockHttpAgentAdapter({ config });

        await adapter.call(defaultInput);

        const headers = sentHeaders();
        expect(headers.Traceparent).toBe(`00-${TRACE_ID}-0000000000000001-01`);
        expect(headers.traceparent).toBeUndefined();
        // Propagation headers the target did not configure still arrive.
        expect(headers.tracestate).toBe("vendor=1");
      });
    });

    describe("when the url and body templates read the trace variables", () => {
      /** @scenario "The url and body templates can read the turn's trace id and traceparent" */
      it("renders the turn's trace id and traceparent in both", async () => {
        injectTraceContext();
        const config: HttpAgentData = {
          ...defaultConfig,
          url: "https://api.example.com/t/{{ traceId }}",
          bodyTemplate: '{"trace": "{{ traceId }}", "parent": "{{ traceparent }}"}',
        };
        const adapter = createMockHttpAgentAdapter({ config });

        await adapter.call(defaultInput);

        expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
          `https://api.example.com/t/${TRACE_ID}`,
          expect.any(Object),
        );
        const body = JSON.parse(
          (mockSsrfSafeFetch.mock.calls[0]![1] as { body: string }).body,
        );
        expect(body).toEqual({ trace: TRACE_ID, parent: TRACEPARENT });
      });
    });
  });

  describe("header value templating", () => {
    const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
    const TRACEPARENT = `00-${TRACE_ID}-b7ad6b7169203331-01`;

    const sentHeaders = (): Record<string, string> =>
      (
        mockSsrfSafeFetch.mock.calls[0]![1] as {
          headers: Record<string, string>;
        }
      ).headers;

    /** @scenario "A header value renders run parameters" */
    it("renders {{ params.NAME }} in a header value", async () => {
      const config: HttpAgentData = {
        ...defaultConfig,
        headers: [{ key: "X-Region", value: "{{ params.region }}" }],
      };
      const adapter = createMockHttpAgentAdapter({
        config,
        parameters: { region: "eu-central" },
      });

      await adapter.call(defaultInput);

      expect(sentHeaders()["X-Region"]).toBe("eu-central");
    });

    /** @scenario "A header value renders the turn's trace id and traceparent" */
    it("renders the turn's trace id and traceparent in header values", async () => {
      mockInjectTraceContextHeaders.mockImplementation(({ headers }) => {
        headers.traceparent = TRACEPARENT;
        return { headers, traceId: TRACE_ID };
      });
      const config: HttpAgentData = {
        ...defaultConfig,
        headers: [
          { key: "X-Trace-Id", value: "{{ traceId }}" },
          { key: "X-Parent", value: "{{ traceparent }}" },
        ],
      };
      const adapter = createMockHttpAgentAdapter({ config });

      await adapter.call(defaultInput);

      expect(sentHeaders()["X-Trace-Id"]).toBe(TRACE_ID);
      expect(sentHeaders()["X-Parent"]).toBe(TRACEPARENT);
    });

    describe("when a header template is malformed", () => {
      /** @scenario "A failing header template names the header it came from" */
      it("rejects naming the header key and the headers field", async () => {
        const config: HttpAgentData = {
          ...defaultConfig,
          headers: [{ key: "X-Broken", value: "{% if %}" }],
        };
        const adapter = createMockHttpAgentAdapter({ config });

        await expect(adapter.call(defaultInput)).rejects.toThrow(TemplateRenderError);
        await expect(adapter.call(defaultInput)).rejects.toMatchObject({
          field: "headers",
          message: expect.stringContaining('header "X-Broken"'),
        });
      });
    });
  });

  describe("URL template interpolation", () => {
    it("renders {{threadId}} placeholder in url", async () => {
      const config: HttpAgentData = {
        ...defaultConfig,
        url: "https://api.example.com/conversations/{{threadId}}/messages",
      };
      const adapter = createMockHttpAgentAdapter({ config });

      await adapter.call(defaultInput);

      expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
        "https://api.example.com/conversations/thread_123/messages",
        expect.any(Object),
      );
    });

    it("URL-encodes interpolated values by default", async () => {
      const config: HttpAgentData = {
        ...defaultConfig,
        url: "https://api.example.com/search/{{input}}",
      };
      const input: AgentInput = {
        ...defaultInput,
        messages: [{ role: "user", content: "hello world & friends?" }],
        newMessages: [{ role: "user", content: "hello world & friends?" }],
      };

      const adapter = createMockHttpAgentAdapter({ config });
      await adapter.call(input);

      expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
        "https://api.example.com/search/hello%20world%20%26%20friends%3F",
        expect.any(Object),
      );
    });

    it("does NOT URL-encode the body template (BC preserved)", async () => {
      const config: HttpAgentData = {
        ...defaultConfig,
        bodyTemplate: '{"query": "{{input}}"}',
      };
      const input: AgentInput = {
        ...defaultInput,
        messages: [{ role: "user", content: "hello world & friends" }],
        newMessages: [{ role: "user", content: "hello world & friends" }],
      };

      const adapter = createMockHttpAgentAdapter({ config });
      await adapter.call(input);

      const callArgs = mockSsrfSafeFetch.mock.calls[0]![1];
      const body = JSON.parse(callArgs?.body as string);
      expect(body.query).toBe("hello world & friends");
    });

    describe("when using `| raw` filter", () => {
      it("skips URL-encoding for raw-filtered values only", async () => {
        const config: HttpAgentData = {
          ...defaultConfig,
          url: "https://api.example.com/{{threadId | raw}}/q/{{input}}",
        };
        const input: AgentInput = {
          ...defaultInput,
          threadId: "path/with/slash",
          messages: [{ role: "user", content: "needs encoding" }],
          newMessages: [{ role: "user", content: "needs encoding" }],
        };

        const adapter = createMockHttpAgentAdapter({ config });
        await adapter.call(input);

        expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
          "https://api.example.com/path/with/slash/q/needs%20encoding",
          expect.any(Object),
        );
      });
    });

    describe("when url has no placeholders", () => {
      it("passes url through unchanged", async () => {
        const adapter = createMockHttpAgentAdapter({
          config: defaultConfig,
        });
        await adapter.call(defaultInput);

        expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
          "https://api.example.com/chat",
          expect.any(Object),
        );
      });
    });

    describe("when url contains Liquid conditional", () => {
      it("renders if-branch when condition is truthy via scenarioMappings", async () => {
        const config: HttpAgentData = {
          ...defaultConfig,
          url: "https://api.example.com{% if conversationId %}/chat/{{conversationId}}/message{% else %}/chat/start{% endif %}",
          scenarioMappings: {
            conversationId: { type: "value", value: "conv-42" },
          },
        };
        const adapter = createMockHttpAgentAdapter({ config });

        await adapter.call(defaultInput);

        expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
          "https://api.example.com/chat/conv-42/message",
          expect.any(Object),
        );
      });

      it("renders else-branch when condition is falsy", async () => {
        const config: HttpAgentData = {
          ...defaultConfig,
          url: "https://api.example.com{% if conversationId %}/chat/{{conversationId}}/message{% else %}/chat/start{% endif %}",
        };
        const adapter = createMockHttpAgentAdapter({ config });

        await adapter.call(defaultInput);

        expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
          "https://api.example.com/chat/start",
          expect.any(Object),
        );
      });
    });

    describe("SSRF regression", () => {
      beforeEach(() => {
        mockSsrfSafeFetch.mockRejectedValue(new Error("Access to private IP denied"));
      });

      it.each([["localhost"], ["127.0.0.1"], ["169.254.169.254"]])(
        "passes the %s-resolved url (post-render) to ssrfSafeFetch",
        async (host) => {
          const config: HttpAgentData = {
            ...defaultConfig,
            url: "https://{{input | raw}}/path",
          };
          const input: AgentInput = {
            ...defaultInput,
            messages: [{ role: "user", content: host }],
            newMessages: [{ role: "user", content: host }],
          };
          const adapter = createMockHttpAgentAdapter({ config });

          await expect(adapter.call(input)).rejects.toThrow();

          expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
            `https://${host}/path`,
            expect.any(Object),
          );
        },
      );
    });

    describe("when url template is malformed", () => {
      it("throws TemplateRenderError with field=url", async () => {
        const config: HttpAgentData = {
          ...defaultConfig,
          url: "https://api.example.com/{% if %}/broken",
        };
        const adapter = createMockHttpAgentAdapter({ config });

        await expect(adapter.call(defaultInput)).rejects.toThrow(TemplateRenderError);

        await expect(adapter.call(defaultInput)).rejects.toMatchObject({
          field: "url",
        });
      });
    });
  });
});
