import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv, envHttpProxyAgentMock, fetchMock } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, unknown>,
  envHttpProxyAgentMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("../../../../env.mjs", () => ({ env: mockEnv }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

// The provider calls undici's fetch, not the global one, so the mock has to
// bind here. Stubbing globalThis.fetch would pass while the provider used a
// different transport entirely.
vi.mock("undici", () => ({
  EnvHttpProxyAgent: envHttpProxyAgentMock,
  fetch: fetchMock,
}));

import { resendProvider } from "../resend";
import { EmailProviderConfigurationError } from "../types";
import { configureProcessOutboundProxy, parseOutboundProxyConfig } from "~/server/outboundProxy";

const setEnv = (values: Record<string, unknown>) => {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  Object.assign(mockEnv, values);
};

const PROXY_ENV_KEYS = [
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
] as const;

const originalProxyEnv = Object.fromEntries(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));

const clearProxyEnv = () => {
  for (const key of PROXY_ENV_KEYS) delete process.env[key];
};

const sentPayload = () => JSON.parse(fetchMock.mock.calls[0]?.[1]?.body);
const sentInit = () => fetchMock.mock.calls[0]?.[1];

describe("resendProvider.send", () => {
  beforeEach(() => {
    setEnv({ RESEND_API_KEY: "re_test_key" });
    clearProxyEnv();
    configureProcessOutboundProxy(parseOutboundProxyConfig(process.env));
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg_123" }),
    });
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalProxyEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe("given no API key", () => {
    it("fails with an actionable error before calling the API", async () => {
      setEnv({});

      await expect(
        resendProvider.send({
          content: { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" },
          defaultFrom: "noreply@langwatch.ai",
        }),
      ).rejects.toThrow(EmailProviderConfigurationError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("given a plain message", () => {
    it("posts to the Resend API with bearer auth", async () => {
      await resendProvider.send({
        content: { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" },
        defaultFrom: "LangWatch <noreply@langwatch.ai>",
      });

      expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.resend.com/emails");
      expect(sentInit().headers.Authorization).toBe("Bearer re_test_key");
      expect(sentPayload()).toMatchObject({
        from: "LangWatch <noreply@langwatch.ai>",
        to: ["a@example.com"],
        subject: "Hi",
        html: "<p>Hi</p>",
      });
    });

    it("returns the provider message id", async () => {
      const result = await resendProvider.send({
        content: { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" },
        defaultFrom: "noreply@langwatch.ai",
      });

      expect(result).toEqual({ id: "msg_123" });
    });
  });

  describe("given the full message surface", () => {
    /** @scenario "The full message surface survives every gateway" */
    it("maps blind copies, reply-to, headers and base64 attachments", async () => {
      await resendProvider.send({
        content: {
          to: ["a@example.com"],
          bcc: ["hidden@example.com"],
          replyTo: "support@langwatch.ai",
          subject: "Report",
          html: "<p>Report</p>",
          headers: { "List-Unsubscribe": "<https://x/unsub>" },
          attachments: [
            {
              filename: "report.csv",
              content: "a,b\n1,2",
              contentType: "text/csv",
            },
          ],
        },
        defaultFrom: "noreply@langwatch.ai",
      });

      expect(sentPayload()).toMatchObject({
        bcc: ["hidden@example.com"],
        reply_to: "support@langwatch.ai",
        headers: { "List-Unsubscribe": "<https://x/unsub>" },
        attachments: [
          {
            filename: "report.csv",
            content: Buffer.from("a,b\n1,2").toString("base64"),
            content_type: "text/csv",
          },
        ],
      });
    });

    it("strips line breaks from custom headers to block injection", async () => {
      await resendProvider.send({
        content: {
          to: "a@example.com",
          subject: "Alert",
          html: "<p>Alert</p>",
          headers: { "X-Custom": "value\r\nBcc: attacker@evil.com" },
        },
        defaultFrom: "noreply@langwatch.ai",
      });

      expect(sentPayload().headers["X-Custom"]).toBe("value Bcc: attacker@evil.com");
    });
  });

  describe("given the transport", () => {
    it("uses undici's fetch, which is the one a dispatcher can apply to", async () => {
      // Node's global fetch is bound to the undici bundled with Node and
      // rejects a dispatcher from this package with "invalid onRequestStart
      // method", so a proxy silently never applies. Pinning the call site.
      const globalFetch = vi.fn();
      vi.stubGlobal("fetch", globalFetch);

      await resendProvider.send({
        content: { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" },
        defaultFrom: "noreply@langwatch.ai",
      });

      expect(fetchMock).toHaveBeenCalled();
      expect(globalFetch).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });

  describe("given an outbound proxy is configured", () => {
    /** @scenario "Email egress follows the configured outbound proxy" */
    it("routes the request through a proxy dispatcher", async () => {
      process.env.HTTPS_PROXY = "http://proxy.corp:8080";
      configureProcessOutboundProxy(parseOutboundProxyConfig(process.env));

      await resendProvider.send({
        content: { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" },
        defaultFrom: "noreply@langwatch.ai",
      });

      expect(envHttpProxyAgentMock).toHaveBeenCalled();
      expect(envHttpProxyAgentMock).toHaveBeenCalledWith({
        httpProxy: "",
        httpsProxy: "http://proxy.corp:8080",
        noProxy: "",
      });
      expect(sentInit().dispatcher).toBeDefined();
    });

    /** @scenario "Hosts excluded from proxying are contacted directly" */
    it("goes direct when the API host is excluded from proxying", async () => {
      process.env.HTTPS_PROXY = "http://proxy.corp:8080";
      process.env.NO_PROXY = "api.resend.com";
      configureProcessOutboundProxy(parseOutboundProxyConfig(process.env));

      await resendProvider.send({
        content: { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" },
        defaultFrom: "noreply@langwatch.ai",
      });

      expect(envHttpProxyAgentMock).not.toHaveBeenCalled();
      expect(sentInit().dispatcher).toBeUndefined();
    });
  });

  describe("given no proxy is configured", () => {
    it("sends without a dispatcher", async () => {
      await resendProvider.send({
        content: { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" },
        defaultFrom: "noreply@langwatch.ai",
      });

      expect(envHttpProxyAgentMock).not.toHaveBeenCalled();
      expect(sentInit().dispatcher).toBeUndefined();
    });
  });

  describe("given the API rejects the message", () => {
    it("surfaces the status so the failure class is diagnosable", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        text: async () => '{"message":"domain is not verified"}',
      });

      await expect(
        resendProvider.send({
          content: { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>" },
          defaultFrom: "noreply@langwatch.ai",
        }),
      ).rejects.toThrow(/422 Unprocessable Entity/);
    });

    it("keeps the response body out of the error, which gets logged", async () => {
      // Resend echoes the request on failure, so the body can carry recipient
      // addresses.
      fetchMock.mockResolvedValue({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        text: async () => '{"to":["private@customer.example"]}',
      });

      await expect(
        resendProvider.send({
          content: {
            to: "private@customer.example",
            subject: "Hi",
            html: "<p>Hi</p>",
          },
          defaultFrom: "noreply@langwatch.ai",
        }),
      ).rejects.toThrow(/^(?!.*private@customer\.example).*$/s);
    });
  });
});
