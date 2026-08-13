/**
 * @vitest-environment node
 *
 * Secret references and run parameters in an http target's request.
 *
 * @see specs/scenarios/http-agent-secret-references.feature
 * @see specs/scenarios/scenario-run-parameters.feature
 */

import { type AgentInput, AgentRole } from "@langwatch/scenario";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpAgentData } from "../../types";
import { SerializedHttpAgentAdapter } from "../http-agent.adapter";

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

import { ssrfSafeFetch } from "~/utils/ssrfProtection";

const mockSsrfSafeFetch = vi.mocked(ssrfSafeFetch);

const SECRET_VALUE = "tok-live-abc123";

function config(overrides: Partial<HttpAgentData> = {}): HttpAgentData {
  return {
    type: "http",
    agentId: "agent_secrets",
    url: "https://api.example.com/chat",
    method: "POST",
    headers: [],
    secrets: { AGENT_TOKEN: SECRET_VALUE },
    outputPath: "$.response",
    ...overrides,
  };
}

const input: AgentInput = {
  threadId: "thread_1",
  messages: [{ role: "user", content: "Hello" }],
  newMessages: [{ role: "user", content: "Hello" }],
  requestedRole: AgentRole.AGENT,
  scenarioState: {} as AgentInput["scenarioState"],
  scenarioConfig: {} as AgentInput["scenarioConfig"],
};

function requestedUrl(): string {
  return mockSsrfSafeFetch.mock.calls[0]![0] as string;
}

function requestedHeaders(): Record<string, string> {
  return (
    mockSsrfSafeFetch.mock.calls[0]![1] as { headers: Record<string, string> }
  ).headers;
}

function requestedBody(): string {
  return (mockSsrfSafeFetch.mock.calls[0]![1] as { body: string }).body;
}

describe("SerializedHttpAgentAdapter secret references", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSsrfSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({ response: "ok" }),
      text: vi.fn().mockResolvedValue("ok"),
    } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);
  });

  describe("given a url that references a project secret", () => {
    /** @scenario "A secret reference in the url resolves to the project secret value" */
    it("sends the request to the url with the secret's value in place", async () => {
      const adapter = new SerializedHttpAgentAdapter({
        config: config({
          url: "https://api.example.com/{{ secrets.AGENT_TOKEN }}/chat",
        }),
      });

      await adapter.call(input);

      expect(requestedUrl()).toBe(
        `https://api.example.com/${SECRET_VALUE}/chat`,
      );
    });

    /** @scenario "A secret reference in the url resolves to the project secret value" */
    it("renders run parameters in the same url alongside the secret", async () => {
      const adapter = new SerializedHttpAgentAdapter({
        config: config({
          url: "https://api.example.com/{{ params.region }}?key={{ secrets.AGENT_TOKEN }}",
        }),
        parameters: { region: "eu-central" },
      });

      await adapter.call(input);

      expect(requestedUrl()).toBe(
        `https://api.example.com/eu-central?key=${SECRET_VALUE}`,
      );
    });
  });

  describe("given a secret value that is itself Liquid template syntax", () => {
    /** @scenario "A resolved secret value is never read as template source" */
    it("sends the value verbatim without letting it close a fence", async () => {
      const adapter = new SerializedHttpAgentAdapter({
        config: config({
          url: "https://api.example.com/{{ secrets.AGENT_TOKEN }}/{{ params.region }}",
          secrets: { AGENT_TOKEN: "x{% endraw %}{{ params.region }}{% raw %}" },
        }),
        parameters: { region: "eu-central" },
      });

      await adapter.call(input);

      // The secret's own `{{ params.region }}` must survive as text. Rendered,
      // it would read the same value the neighbouring expression renders, and
      // the two would be indistinguishable in the result.
      expect(requestedUrl()).toBe(
        "https://api.example.com/x{% endraw %}{{ params.region }}{% raw %}/eu-central",
      );
    });
  });

  describe("given one secret value that contains another", () => {
    /** @scenario "A failure message shows no resolved secret value" */
    it("redacts the longer value whole rather than leaving its tail", async () => {
      const adapter = new SerializedHttpAgentAdapter({
        config: config({
          url: "https://api.example.com/{{ secrets.LONG }}",
          secrets: { SHORT: "abc", LONG: "abcdef" },
        }),
      });
      mockSsrfSafeFetch.mockRejectedValue(
        new Error("connect failed for https://api.example.com/abcdef"),
      );

      await expect(adapter.call(input)).rejects.toMatchObject({
        message: "connect failed for https://api.example.com/[redacted]",
      });
    });
  });

  describe("given headers and auth fields that reference a project secret", () => {
    /** @scenario "Secret references resolve in header values and auth token, value, username, and password" */
    it("carries the secret's value in the header value", async () => {
      const adapter = new SerializedHttpAgentAdapter({
        config: config({
          headers: [{ key: "X-Agent-Key", value: "{{ secrets.AGENT_TOKEN }}" }],
        }),
      });

      await adapter.call(input);

      expect(requestedHeaders()["X-Agent-Key"]).toBe(SECRET_VALUE);
    });

    /** @scenario "Secret references resolve in header values and auth token, value, username, and password" */
    it("carries the secret's value in a bearer auth token", async () => {
      const adapter = new SerializedHttpAgentAdapter({
        config: config({
          auth: { type: "bearer", token: "{{ secrets.AGENT_TOKEN }}" },
        }),
      });

      await adapter.call(input);

      expect(requestedHeaders().Authorization).toBe(`Bearer ${SECRET_VALUE}`);
    });

    /** @scenario "Secret references resolve in header values and auth token, value, username, and password" */
    it("carries the secret's value in an api key auth value", async () => {
      const adapter = new SerializedHttpAgentAdapter({
        config: config({
          auth: {
            type: "api_key",
            header: "X-Api-Key",
            value: "{{ secrets.AGENT_TOKEN }}",
          },
        }),
      });

      await adapter.call(input);

      expect(requestedHeaders()["X-Api-Key"]).toBe(SECRET_VALUE);
    });

    /** @scenario "Secret references resolve in header values and auth token, value, username, and password" */
    it("carries the secret's value in basic auth username and password", async () => {
      const adapter = new SerializedHttpAgentAdapter({
        config: config({
          auth: {
            type: "basic",
            username: "{{ secrets.AGENT_TOKEN }}",
            password: "{{ secrets.AGENT_TOKEN }}",
          },
        }),
      });

      await adapter.call(input);

      const expected = Buffer.from(`${SECRET_VALUE}:${SECRET_VALUE}`).toString(
        "base64",
      );
      expect(requestedHeaders().Authorization).toBe(`Basic ${expected}`);
    });

    /** @scenario "Secret references resolve in header values and auth token, value, username, and password" */
    it("leaves the target's own auth config unresolved for the next turn", async () => {
      const agentConfig = config({
        auth: { type: "bearer", token: "{{ secrets.AGENT_TOKEN }}" },
      });
      const adapter = new SerializedHttpAgentAdapter({ config: agentConfig });

      await adapter.call(input);

      expect(agentConfig.auth).toEqual({
        type: "bearer",
        token: "{{ secrets.AGENT_TOKEN }}",
      });
    });
  });

  describe("given a body template that references a project secret", () => {
    /** @scenario "A secret reference in the body template is left untouched" */
    it("sends the reference exactly as written", async () => {
      const adapter = new SerializedHttpAgentAdapter({
        config: config({
          bodyTemplate: '{"token": "{{ secrets.AGENT_TOKEN }}"}',
        }),
      });

      await adapter.call(input);

      expect(requestedBody()).toContain("secrets.AGENT_TOKEN");
      expect(requestedBody()).not.toContain(SECRET_VALUE);
    });
  });

  describe("given a reference to a name the project does not have", () => {
    /** @scenario "A reference to a missing secret name stays verbatim in the request" */
    it("carries the reference exactly as written in the url", async () => {
      const adapter = new SerializedHttpAgentAdapter({
        config: config({
          url: "https://api.example.com/{{ secrets.NOT_A_SECRET }}",
          secrets: {},
        }),
      });

      await adapter.call(input);

      expect(requestedUrl()).toBe(
        "https://api.example.com/{{ secrets.NOT_A_SECRET }}",
      );
    });

    /** @scenario "A reference to a missing secret name stays verbatim in the request" */
    it("carries the reference exactly as written in a header value", async () => {
      const adapter = new SerializedHttpAgentAdapter({
        config: config({
          headers: [
            { key: "X-Agent-Key", value: "{{ secrets.NOT_A_SECRET }}" },
          ],
        }),
      });

      await adapter.call(input);

      expect(requestedHeaders()["X-Agent-Key"]).toBe(
        "{{ secrets.NOT_A_SECRET }}",
      );
    });
  });

  describe("given the upstream rejects a request carrying a resolved secret", () => {
    /** @scenario "A resolved secret value is scrubbed from error messages" */
    it("names the failure without the secret's value anywhere in it", async () => {
      mockSsrfSafeFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        headers: new Headers(),
        text: vi
          .fn()
          .mockResolvedValue(`{"error":"bad token ${SECRET_VALUE}"}`),
        json: vi.fn(),
      } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);

      const adapter = new SerializedHttpAgentAdapter({
        config: config({
          url: "https://api.example.com/{{ secrets.AGENT_TOKEN }}",
        }),
      });

      await expect(adapter.call(input)).rejects.toThrow(/HTTP 401/);
      await expect(adapter.call(input)).rejects.not.toThrow(
        new RegExp(SECRET_VALUE),
      );
    });

    /** @scenario "A resolved secret value is scrubbed from error messages" */
    it("scrubs the secret out of a transport failure and everything it was caused by", async () => {
      const cause = new Error(
        `connect ECONNREFUSED for https://api.example.com/${SECRET_VALUE}`,
      );
      mockSsrfSafeFetch.mockRejectedValue(
        new TypeError("fetch failed", { cause }),
      );

      const adapter = new SerializedHttpAgentAdapter({
        config: config({
          url: "https://api.example.com/{{ secrets.AGENT_TOKEN }}",
        }),
      });

      await expect(adapter.call(input)).rejects.toThrow("fetch failed");
      expect(cause.message).toBe(
        "connect ECONNREFUSED for https://api.example.com/[redacted]",
      );
    });
  });

  describe("given auth fields typed in directly, with no references", () => {
    /** @scenario "Plaintext auth without secret references behaves unchanged" */
    it("carries exactly what was typed in", async () => {
      const adapter = new SerializedHttpAgentAdapter({
        config: config({
          secrets: {},
          headers: [{ key: "X-Plain", value: "plain-header-value" }],
          auth: { type: "bearer", token: "plain-token" },
        }),
      });

      await adapter.call(input);

      expect(requestedHeaders()).toMatchObject({
        "Content-Type": "application/json",
        "X-Plain": "plain-header-value",
        Authorization: "Bearer plain-token",
      });
    });

    /** @scenario "Plaintext auth without secret references behaves unchanged" */
    it("rethrows an upstream failure untouched", async () => {
      const thrown = new Error("fetch failed");
      mockSsrfSafeFetch.mockRejectedValue(thrown);

      const adapter = new SerializedHttpAgentAdapter({
        config: config({
          secrets: {},
          auth: { type: "bearer", token: "plain-token" },
        }),
      });

      await expect(adapter.call(input)).rejects.toBe(thrown);
      expect(thrown.message).toBe("fetch failed");
    });
  });
});

describe("SerializedHttpAgentAdapter run parameters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSsrfSafeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({ response: "ok" }),
      text: vi.fn().mockResolvedValue("ok"),
    } as unknown as Awaited<ReturnType<typeof ssrfSafeFetch>>);
  });

  describe("given a url and body template that read a parameter", () => {
    /** @scenario "An http target reads params in its url and body templates" */
    it("carries the resolved value in both", async () => {
      const adapter = new SerializedHttpAgentAdapter({
        config: config({
          url: "https://api.example.com/tiers/{{ params.account_tier }}",
          bodyTemplate: '{"tier": "{{ params.account_tier }}"}',
          secrets: {},
        }),
        parameters: { account_tier: "platinum" },
      });

      await adapter.call(input);

      expect(requestedUrl()).toBe("https://api.example.com/tiers/platinum");
      expect(requestedBody()).toBe('{"tier": "platinum"}');
    });
  });
});
