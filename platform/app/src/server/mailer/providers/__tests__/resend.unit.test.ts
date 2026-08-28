import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { EnvHttpProxyAgent, fetch } = vi.hoisted(() => ({
  EnvHttpProxyAgent: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("undici", () => ({ EnvHttpProxyAgent, fetch }));

import { ResendEmailProvider } from "../resend";

describe("ResendEmailProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetch.mockResolvedValue({ ok: true, json: async () => ({ id: "message" }) });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses one proxy dispatcher, preserves the full message surface, and closes it", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    EnvHttpProxyAgent.mockImplementation(
      class EnvHttpProxyAgent {
        close = close;
      },
    );
    const provider = ResendEmailProvider.create({
      configuration: { apiKey: "re_test" },
      outboundProxy: { httpsProxy: "http://proxy.example:8080" },
    });
    await provider.send({
      content: {
        to: "public@example.com",
        bcc: "hidden@example.com",
        subject: "Alert",
        html: "<p>Alert</p>",
        headers: { "X-Name": "value\r\nBcc: injected@example.com" },
      },
      defaultFrom: "noreply@example.com",
    });
    await provider.send({
      content: { to: "second@example.com", subject: "Second", html: "<p>Second</p>" },
      defaultFrom: "noreply@example.com",
    });

    expect(EnvHttpProxyAgent).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer re_test" },
    });
    const firstPayload = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string) as {
      bcc: string[];
      headers: Record<string, string>;
    };
    expect(firstPayload.bcc).toEqual(["hidden@example.com"]);
    expect(firstPayload.headers["X-Name"]).toBe("value Bcc: injected@example.com");
    await provider.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not expose a rejected response body", async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      body: { cancel: vi.fn().mockResolvedValue(undefined) },
    });
    const provider = ResendEmailProvider.create({
      configuration: { apiKey: "re_test" },
      outboundProxy: {},
    });

    await expect(
      provider.send({
        content: { to: "private@example.com", subject: "Alert", html: "<p>Alert</p>" },
        defaultFrom: "noreply@example.com",
      }),
    ).rejects.toThrow("422 Unprocessable Entity");
  });

  it("bypasses proxy construction when no proxy applies and rejects absent credentials", async () => {
    const provider = ResendEmailProvider.create({
      configuration: {},
      outboundProxy: {},
    });
    await expect(
      provider.send({
        content: { to: "private@example.com", subject: "Alert", html: "<p>Alert</p>" },
        defaultFrom: "noreply@example.com",
      }),
    ).rejects.toThrow("RESEND_API_KEY");
    expect(EnvHttpProxyAgent).not.toHaveBeenCalled();
  });
});
