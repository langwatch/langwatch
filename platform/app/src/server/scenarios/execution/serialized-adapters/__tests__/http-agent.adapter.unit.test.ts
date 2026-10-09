/**
 * @vitest-environment node
 */

import { type AgentInput, AgentRole } from "@langwatch/scenario";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyScenarioInfraError,
  ScenarioInfraErrorCode,
} from "~/server/scenarios/scenario-infra-error";
import { TemplateRenderError } from "../../http-template-engine";
import type { HttpAgentData } from "../../types";
import { SerializedHttpAgentAdapter } from "../http-agent.adapter";

// Mock dependencies
vi.mock("~/utils/ssrfProtection", () => ({
  ssrfSafeFetch: vi.fn(),
}));

vi.mock("@langwatch/observability/tracing", () => ({
  injectTraceContextHeaders: vi.fn(
    ({ headers }: { headers: Record<string, string> }) => ({
      headers,
      traceId: undefined,
    }),
  ),
}));

import { injectTraceContextHeaders } from "@langwatch/observability/tracing";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";

const mockSsrfSafeFetch = vi.mocked(ssrfSafeFetch);
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
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({ response: "API response" }),
      text: vi.fn().mockResolvedValue("API response"),
    } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);
  });

  it("has AGENT role", () => {
    const adapter = new SerializedHttpAgentAdapter({ config: defaultConfig });
    expect(adapter.role).toBe(AgentRole.AGENT);
  });

  it("reports the adapter name", () => {
    const adapter = new SerializedHttpAgentAdapter({ config: defaultConfig });
    expect(adapter.name).toBe("SerializedHttpAgentAdapter");
  });

  it("makes HTTP request with correct URL and method", async () => {
    const adapter = new SerializedHttpAgentAdapter({ config: defaultConfig });

    await adapter.call(defaultInput);

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "https://api.example.com/chat",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("includes Content-Type header", async () => {
    const adapter = new SerializedHttpAgentAdapter({ config: defaultConfig });

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
    const adapter = new SerializedHttpAgentAdapter({ config });

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
    const adapter = new SerializedHttpAgentAdapter({ config });

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
    const adapter = new SerializedHttpAgentAdapter({ config });

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
    const adapter = new SerializedHttpAgentAdapter({ config: defaultConfig });

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
      text: vi.fn().mockResolvedValue('{"data":"value"}'),
    } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);

    const adapter = new SerializedHttpAgentAdapter({ config });
    const result = await adapter.call(defaultInput);

    expect(result).toBe('{"data":"value"}');
  });

  it("throws on HTTP error", async () => {
    mockSsrfSafeFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
      text: vi.fn().mockResolvedValue(""),
    } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);

    const adapter = new SerializedHttpAgentAdapter({ config: defaultConfig });

    await expect(adapter.call(defaultInput)).rejects.toThrow(
      "HTTP 500: Internal Server Error",
    );
  });

  it("does not send body for GET requests", async () => {
    const config: HttpAgentData = { ...defaultConfig, method: "GET" };
    const adapter = new SerializedHttpAgentAdapter({ config });

    await adapter.call(defaultInput);

    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: undefined,
      }),
    );
  });

  describe("when the target cannot be reached at all", () => {
    // A transport failure is not the target rejecting the request: nothing
    // answered. What fetch throws reads as a Node crash, so the adapter has
    // to restate it as a reason before it reaches a customer.
    function rejectTransportWith(error: Error) {
      mockSsrfSafeFetch.mockRejectedValue(error);
      return new SerializedHttpAgentAdapter({ config: defaultConfig });
    }

    /** @scenario "An unreachable target produces a customer-safe transport error" */
    it("names the target host and the failure, and keeps the raw error as cause", async () => {
      const raw = new Error("getaddrinfo ENOTFOUND api.example.com");
      const adapter = rejectTransportWith(raw);

      const thrown = await adapter.call(defaultInput).catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(Error);
      const error = thrown as Error;
      expect(error.message).toContain("api.example.com");
      expect(error.message).toContain("could not be reached");
      expect(error.cause).toBe(raw);
    });

    /** @scenario "A target url that does not parse is never repeated in the error" */
    it("labels a url that does not parse instead of repeating it", async () => {
      mockSsrfSafeFetch.mockRejectedValue(new Error("fetch failed"));
      const adapter = new SerializedHttpAgentAdapter({
        config: {
          ...defaultConfig,
          url: "not a url?token=super-secret-value",
        },
      });

      const thrown = (await adapter
        .call(defaultInput)
        .catch((e: unknown) => e)) as Error;

      expect(thrown.message).toContain("configured target");
      expect(thrown.message).not.toContain("super-secret-value");
    });

    /** @scenario "A transport error keeps the underlying failure text for classification" */
    it("keeps the underlying failure text so the classifier still sees it", async () => {
      const adapter = rejectTransportWith(
        new Error("connect ECONNREFUSED 127.0.0.1:443"),
      );

      const thrown = (await adapter
        .call(defaultInput)
        .catch((e: unknown) => e)) as Error;

      expect(thrown.message).toContain("ECONNREFUSED");
      expect(classifyScenarioInfraError(thrown.message).code).toBe(
        ScenarioInfraErrorCode.PlatformUnreachable,
      );
    });

    /** @scenario "A transport error never carries a Node stack in its message" */
    it("carries no stack frames in the message", async () => {
      const raw = new Error("fetch failed");
      raw.stack =
        "Error: fetch failed\n    at node:internal/deps/undici/undici:13502:13\n" +
        "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)";
      const adapter = rejectTransportWith(raw);

      const thrown = (await adapter
        .call(defaultInput)
        .catch((e: unknown) => e)) as Error;

      expect(thrown.message).not.toContain("    at ");
      expect(thrown.message).not.toContain("node:internal");
    });

    it("does not restate a template error as a transport failure", async () => {
      // Only the fetch itself is a transport seam; errors raised before it
      // must keep their own type so their own handling still applies.
      const adapter = new SerializedHttpAgentAdapter({
        config: { ...defaultConfig, bodyTemplate: "{{ unclosed " },
      });

      const thrown = await adapter.call(defaultInput).catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(TemplateRenderError);
    });
  });

  describe("body templating", () => {
    it("replaces {{messages}} placeholder", async () => {
      const config: HttpAgentData = {
        ...defaultConfig,
        bodyTemplate: '{"messages": {{messages}}}',
      };
      const adapter = new SerializedHttpAgentAdapter({ config });

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
      const adapter = new SerializedHttpAgentAdapter({ config });

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
      const adapter = new SerializedHttpAgentAdapter({ config });

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
        const adapter = new SerializedHttpAgentAdapter({ config });

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
      const adapter = new SerializedHttpAgentAdapter({ config });

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
      const adapter = new SerializedHttpAgentAdapter({ config });

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
      const adapter = new SerializedHttpAgentAdapter({ config: defaultConfig });

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
        const adapter = new SerializedHttpAgentAdapter({ config });

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
          bodyTemplate:
            '{"trace": "{{ traceId }}", "parent": "{{ traceparent }}"}',
        };
        const adapter = new SerializedHttpAgentAdapter({ config });

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
      const adapter = new SerializedHttpAgentAdapter({
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
      const adapter = new SerializedHttpAgentAdapter({ config });

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
        const adapter = new SerializedHttpAgentAdapter({ config });

        await expect(adapter.call(defaultInput)).rejects.toThrow(
          TemplateRenderError,
        );
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
      const adapter = new SerializedHttpAgentAdapter({ config });

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

      const adapter = new SerializedHttpAgentAdapter({ config });
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

      const adapter = new SerializedHttpAgentAdapter({ config });
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

        const adapter = new SerializedHttpAgentAdapter({ config });
        await adapter.call(input);

        expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
          "https://api.example.com/path/with/slash/q/needs%20encoding",
          expect.any(Object),
        );
      });
    });

    describe("when url has no placeholders", () => {
      it("passes url through unchanged", async () => {
        const adapter = new SerializedHttpAgentAdapter({
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
        const adapter = new SerializedHttpAgentAdapter({ config });

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
        const adapter = new SerializedHttpAgentAdapter({ config });

        await adapter.call(defaultInput);

        expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
          "https://api.example.com/chat/start",
          expect.any(Object),
        );
      });
    });

    describe("SSRF regression", () => {
      beforeEach(() => {
        mockSsrfSafeFetch.mockRejectedValue(
          new Error("Access to private IP denied"),
        );
      });

      it.each([
        ["localhost"],
        ["127.0.0.1"],
        ["169.254.169.254"],
      ])("passes the %s-resolved url (post-render) to ssrfSafeFetch", async (host) => {
        const config: HttpAgentData = {
          ...defaultConfig,
          url: "https://{{input | raw}}/path",
        };
        const input: AgentInput = {
          ...defaultInput,
          messages: [{ role: "user", content: host }],
          newMessages: [{ role: "user", content: host }],
        };
        const adapter = new SerializedHttpAgentAdapter({ config });

        await expect(adapter.call(input)).rejects.toThrow();

        expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
          `https://${host}/path`,
          expect.any(Object),
        );
      });
    });

    describe("when url template is malformed", () => {
      it("throws TemplateRenderError with field=url", async () => {
        const config: HttpAgentData = {
          ...defaultConfig,
          url: "https://api.example.com/{% if %}/broken",
        };
        const adapter = new SerializedHttpAgentAdapter({ config });

        await expect(adapter.call(defaultInput)).rejects.toThrow(
          TemplateRenderError,
        );

        await expect(adapter.call(defaultInput)).rejects.toMatchObject({
          field: "url",
        });
      });
    });
  });

  describe("given a target with a session path", () => {
    const sessionConfig: HttpAgentData = {
      ...defaultConfig,
      url: "https://api.example.com/chat/{{ session }}",
      headers: [{ key: "X-Session", value: "{{ session }}" }],
      bodyTemplate: '{"session": "{{ session }}", "input": "{{ input }}"}',
      outputPath: "$.reply",
      sessionPath: "$.conversation_id",
    };

    const reply = (body: Record<string, unknown>) =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: vi.fn().mockResolvedValue(body),
        text: vi.fn().mockResolvedValue(JSON.stringify(body)),
      }) as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>;

    const turn = (threadId: string, text: string): AgentInput => ({
      ...defaultInput,
      threadId,
      messages: [{ role: "user", content: text }],
      newMessages: [{ role: "user", content: text }],
    });

    /** What the nth request carried: its url, its headers and its parsed body. */
    const sent = (call: number) => {
      const [url, init] = mockSsrfSafeFetch.mock.calls[call] as [
        string,
        { headers: Record<string, string>; body: string },
      ];
      return { url, headers: init.headers, body: JSON.parse(init.body) };
    };

    describe("when the response carries a value at the session path", () => {
      /** @scenario "An HTTP agent receives the session it returned in the url, the headers and the body" */
      /** @scenario "An HTTP agent renders an empty session on the first turn" */
      /** @scenario "Two threads of one HTTP agent run do not share a session" */
      it("renders it empty on the first turn, then in the url, a header and the body, and not for another thread", async () => {
        mockSsrfSafeFetch
          .mockResolvedValueOnce(
            reply({ reply: "one", conversation_id: "conv_1" }),
          )
          .mockResolvedValueOnce(
            reply({ reply: "two", conversation_id: "conv_1" }),
          )
          .mockResolvedValueOnce(reply({ reply: "other" }));
        const adapter = new SerializedHttpAgentAdapter({
          config: sessionConfig,
        });

        await expect(adapter.call(turn("thread_a", "first"))).resolves.toBe(
          "one",
        );
        await expect(adapter.call(turn("thread_a", "second"))).resolves.toBe(
          "two",
        );
        await expect(adapter.call(turn("thread_b", "hello"))).resolves.toBe(
          "other",
        );

        expect(sent(0).url).toBe("https://api.example.com/chat/");
        expect(sent(0).headers["X-Session"]).toBe("");
        expect(sent(0).body.session).toBe("");

        expect(sent(1).url).toBe("https://api.example.com/chat/conv_1");
        expect(sent(1).headers["X-Session"]).toBe("conv_1");
        expect(sent(1).body.session).toBe("conv_1");

        expect(sent(2).url).toBe("https://api.example.com/chat/");
        expect(sent(2).body.session).toBe("");
      });

      /** @scenario "A response with no match at the session path leaves the held value unchanged" */
      it("keeps the held value when a later response has nothing at the path", async () => {
        mockSsrfSafeFetch
          .mockResolvedValueOnce(
            reply({ reply: "one", conversation_id: "conv_1" }),
          )
          .mockResolvedValueOnce(reply({ reply: "two" }))
          .mockResolvedValueOnce(reply({ reply: "three" }));
        const adapter = new SerializedHttpAgentAdapter({
          config: sessionConfig,
        });

        await adapter.call(turn("thread_a", "first"));
        await adapter.call(turn("thread_a", "second"));
        await adapter.call(turn("thread_a", "third"));

        expect(sent(2).body.session).toBe("conv_1");
      });

      /** @scenario "A structured session renders as raw JSON in the body" */
      it("renders an object session as raw JSON in the body", async () => {
        mockSsrfSafeFetch
          .mockResolvedValueOnce(
            reply({ reply: "one", state: { step: 2, seen: ["a"] } }),
          )
          .mockResolvedValueOnce(reply({ reply: "two" }));
        const adapter = new SerializedHttpAgentAdapter({
          config: {
            ...sessionConfig,
            url: "https://api.example.com/chat",
            headers: [],
            bodyTemplate: '{"state": {{ session }}}',
            sessionPath: "$.state",
          },
        });

        await adapter.call(turn("thread_a", "first"));
        await adapter.call(turn("thread_a", "second"));

        expect(sent(1).body.state).toEqual({ step: 2, seen: ["a"] });
      });
    });

    describe("when the response carries a session above the cap", () => {
      /** @scenario "An HTTP agent session above the cap fails the turn" */
      it("fails the turn with the payload code", async () => {
        mockSsrfSafeFetch.mockResolvedValueOnce(
          reply({ reply: "one", conversation_id: "x".repeat(70_000) }),
        );
        const adapter = new SerializedHttpAgentAdapter({
          config: sessionConfig,
        });

        await expect(adapter.call(turn("thread_a", "first"))).rejects.toThrow(
          /agent_payload_too_large/,
        );
      });
    });
  });
});
