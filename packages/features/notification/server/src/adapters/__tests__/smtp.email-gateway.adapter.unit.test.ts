import { beforeEach, describe, expect, it, vi } from "vitest";

const { close, createTransport, sendMail } = vi.hoisted(() => ({
  close: vi.fn(),
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({ default: { createTransport } }));

import { EmailProviderConfigurationError } from "../../ports/email-delivery.port";
import { SmtpEmailGatewayAdapter } from "../smtp.email-gateway.adapter";

/**
 * Spec: packages/features/notification/specs/packaged-mail-delivery.feature
 */
describe("given an SMTP deployment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMail.mockResolvedValue({ messageId: "message" });
    createTransport.mockReturnValue({ sendMail, close });
  });

  describe("when the transport options are built", () => {
    /** @scenario "The gateway named by the deployment is the one that sends" */
    it("prefers a connection URL over the discrete settings", () => {
      expect(
        SmtpEmailGatewayAdapter.buildTransportOptions({
          url: "smtp://localhost:1025",
          host: "ignored.example",
        }),
      ).toMatchObject({ url: "smtp://localhost:1025" });
    });

    /** @scenario "The gateway named by the deployment is the one that sends" */
    it("uses the documented port, TLS and credential defaults", () => {
      expect(
        SmtpEmailGatewayAdapter.buildTransportOptions({ host: "relay.example" }),
      ).toMatchObject({ port: 587, secure: false });
      expect(
        SmtpEmailGatewayAdapter.buildTransportOptions({ host: "relay.example", port: "465" }),
      ).toMatchObject({ port: 465, secure: true });
      expect(
        SmtpEmailGatewayAdapter.buildTransportOptions({
          host: "relay.example",
          port: "465",
          secure: "false",
          user: "mailer",
          password: "secret",
        }),
      ).toMatchObject({ secure: false, auth: { user: "mailer", pass: "secret" } });
    });

    /** @scenario "A named but unusable gateway refuses instead of falling back" */
    it("refuses a relay it cannot address", () => {
      expect(() => SmtpEmailGatewayAdapter.buildTransportOptions({})).toThrow(
        EmailProviderConfigurationError,
      );
      expect(() =>
        SmtpEmailGatewayAdapter.buildTransportOptions({ host: "relay.example", port: "bad" }),
      ).toThrow(/SMTP_PORT/);
    });
  });

  describe("when a message with blind recipients is sent", () => {
    /** @scenario "Blind recipients never reach the rendered headers" */
    /** @scenario "A crafted header cannot inject another one" */
    it("keeps the blind addresses in the envelope only, over one pooled transport", async () => {
      const gateway = SmtpEmailGatewayAdapter.create({ url: "smtp://localhost:1025" });
      await gateway.send({
        content: {
          to: ["public@acme.example"],
          bcc: ["hidden@acme.example"],
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

      expect(createTransport).toHaveBeenCalledOnce();
      const first = sendMail.mock.calls[0]?.[0] as {
        to: string[];
        bcc?: unknown;
        envelope: { to: string[] };
        headers: Record<string, string>;
      };
      expect(first.to).toEqual(["public@acme.example"]);
      expect(first.bcc).toBeUndefined();
      expect(first.envelope.to).toEqual(["public@acme.example", "hidden@acme.example"]);
      expect(first.headers["X-Name"]).toBe("value Bcc: injected@acme.example");
    });
  });

  describe("when the gateway is closed", () => {
    /** @scenario "Closing the capability releases the transport once" */
    it("refuses a later send", async () => {
      const gateway = SmtpEmailGatewayAdapter.create({ url: "smtp://localhost:1025" });
      await gateway.send({
        content: { to: "public@acme.example", subject: "Alert", html: "<p>Alert</p>" },
        defaultFrom: "noreply@acme.example",
      });

      await gateway.close();

      expect(close).toHaveBeenCalledOnce();
      await expect(
        gateway.send({
          content: { to: "public@acme.example", subject: "Alert", html: "<p>Alert</p>" },
          defaultFrom: "noreply@acme.example",
        }),
      ).rejects.toThrow(/closed/);
    });
  });
});
