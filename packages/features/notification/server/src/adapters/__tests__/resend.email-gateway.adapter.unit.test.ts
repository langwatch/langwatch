import { beforeEach, describe, expect, it, vi } from "vitest";

const { EnvHttpProxyAgent, fetch } = vi.hoisted(() => ({
  EnvHttpProxyAgent: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("undici", () => ({ EnvHttpProxyAgent, fetch }));

import { ResendEmailGatewayAdapter } from "../resend.email-gateway.adapter";

/**
 * Spec: packages/features/notification/specs/packaged-mail-delivery.feature
 */
beforeEach(() => {
  vi.clearAllMocks();
  fetch.mockResolvedValue({ ok: true, json: async () => ({ id: "message" }) });
});

describe("given a Resend deployment behind an outbound proxy", () => {
  describe("when two messages are sent", () => {
    /** @scenario "The gateway named by the deployment is the one that sends" */
    /** @scenario "Blind recipients never reach the rendered headers" */
    /** @scenario "A crafted header cannot inject another one" */
    it("builds one dispatcher and carries the whole message surface", async () => {
      const close = vi.fn().mockResolvedValue(undefined);
      EnvHttpProxyAgent.mockImplementation(function (this: { close: () => Promise<void> }) {
        this.close = close;
      });
      const gateway = ResendEmailGatewayAdapter.create({
        configuration: { apiKey: "re_test" },
        outboundProxy: { httpsProxy: "http://proxy.acme.example:8080" },
      });
      await gateway.send({
        content: {
          to: "public@acme.example",
          bcc: "hidden@acme.example",
          subject: "Alert",
          html: "<p>Alert</p>",
          headers: { "X-Name": "value\r\nBcc: injected@acme.example" },
        },
        defaultFrom: "noreply@acme.example",
      });
      await gateway.send({
        content: { to: "second@acme.example", subject: "Second", html: "<p>Second</p>" },
        defaultFrom: "noreply@acme.example",
      });

      expect(EnvHttpProxyAgent).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0]?.[1]).toMatchObject({
        headers: { Authorization: "Bearer re_test" },
      });
      const payload = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string) as {
        to: string[];
        bcc: string[];
        headers: Record<string, string>;
      };
      // Blind addresses travel in the envelope, never the rendered headers.
      expect(payload.to).toEqual(["public@acme.example"]);
      expect(payload.bcc).toEqual(["hidden@acme.example"]);
      // A crafted header cannot close its field and open another.
      expect(payload.headers["X-Name"]).toBe("value Bcc: injected@acme.example");

      await gateway.close();
      expect(close).toHaveBeenCalledOnce();
    });
  });

  describe("when the proxy excludes the vendor host", () => {
    /** @scenario "The gateway named by the deployment is the one that sends" */
    it("sends without a dispatcher", async () => {
      const gateway = ResendEmailGatewayAdapter.create({
        configuration: { apiKey: "re_test" },
        outboundProxy: {
          httpsProxy: "http://proxy.acme.example:8080",
          noProxy: ".resend.com",
        },
      });
      await gateway.send({
        content: { to: "public@acme.example", subject: "Alert", html: "<p>Alert</p>" },
        defaultFrom: "noreply@acme.example",
      });

      expect(EnvHttpProxyAgent).not.toHaveBeenCalled();
      expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty("dispatcher");
    });
  });
});

describe("given a Resend deployment with no API key", () => {
  describe("when a message is sent", () => {
    /** @scenario "A named but unusable gateway refuses instead of falling back" */
    it("refuses naming the setting rather than calling the vendor", async () => {
      const gateway = ResendEmailGatewayAdapter.create({
        configuration: {},
        outboundProxy: {},
      });

      await expect(
        gateway.send({
          content: { to: "public@acme.example", subject: "Alert", html: "<p>Alert</p>" },
          defaultFrom: "noreply@acme.example",
        }),
      ).rejects.toThrow(/RESEND_API_KEY/);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});

describe("given the vendor rejects a send", () => {
  describe("when the response is not ok", () => {
    /** @scenario "A deployment with no provider composes and fails only at send time" */
    it("raises the status without reading a body that echoes recipients", async () => {
      const cancel = vi.fn().mockResolvedValue(undefined);
      const json = vi.fn();
      fetch.mockResolvedValue({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        body: { cancel },
        json,
      });
      const gateway = ResendEmailGatewayAdapter.create({
        configuration: { apiKey: "re_test" },
        outboundProxy: {},
      });

      await expect(
        gateway.send({
          content: { to: "public@acme.example", subject: "Alert", html: "<p>Alert</p>" },
          defaultFrom: "noreply@acme.example",
        }),
      ).rejects.toThrow(/Resend responded 422/);
      expect(cancel).toHaveBeenCalledOnce();
      expect(json).not.toHaveBeenCalled();
    });
  });
});
