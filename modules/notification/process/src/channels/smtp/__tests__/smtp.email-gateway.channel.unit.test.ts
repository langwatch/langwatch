import { beforeEach, describe, expect, it, vi } from "vitest";

const { close, createTransport, sendMail } = vi.hoisted(() => ({
  close: vi.fn(),
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({ default: { createTransport } }));

import { EmailProviderConfigurationError } from "../../email-delivery.channel.ts";
import { SmtpEmailGatewayChannel } from "../smtp.email-gateway.channel.ts";

/**
 * Spec: modules/notification/specs/packaged-mail-delivery.feature
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
        SmtpEmailGatewayChannel.buildTransportOptions({
          url: "smtp://localhost:1025",
          host: "ignored.example",
        }),
      ).toMatchObject({ url: "smtp://localhost:1025" });
    });

    /** @scenario "The gateway named by the deployment is the one that sends" */
    it("uses the documented port, TLS and credential defaults", () => {
      expect(
        SmtpEmailGatewayChannel.buildTransportOptions({ host: "relay.example" }),
      ).toMatchObject({ port: 587, secure: false });
      expect(
        SmtpEmailGatewayChannel.buildTransportOptions({ host: "relay.example", port: "465" }),
      ).toMatchObject({ port: 465, secure: true });
      expect(
        SmtpEmailGatewayChannel.buildTransportOptions({
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
      expect(() => SmtpEmailGatewayChannel.buildTransportOptions({})).toThrow(
        EmailProviderConfigurationError,
      );
      expect(() =>
        SmtpEmailGatewayChannel.buildTransportOptions({ host: "relay.example", port: "bad" }),
      ).toThrow(/SMTP_PORT/);
    });
  });

  describe("when a message with blind recipients is sent", () => {
    /** @scenario "Blind recipients never reach the rendered headers" */
    /** @scenario "A crafted header cannot inject another one" */
    it("keeps the blind addresses in the envelope only, over one pooled transport", async () => {
      const gateway = SmtpEmailGatewayChannel.create({ url: "smtp://localhost:1025" });
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
      const gateway = SmtpEmailGatewayChannel.create({ url: "smtp://localhost:1025" });
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

  describe("when a message carries the full surface", () => {
    /** @scenario "The full message surface survives every gateway" */
    it("hands the transport attachments, reply-to and headers, blind copies in the envelope only", async () => {
      const gateway = SmtpEmailGatewayChannel.create({ url: "smtp://localhost:1025" });
      await gateway.send({
        content: {
          to: ["public@acme.example"],
          bcc: ["hidden@acme.example"],
          replyTo: "help@acme.example",
          subject: "Report",
          html: "<p>Report</p>",
          headers: { "X-Report": "weekly" },
          attachments: [{ filename: "report.csv", content: "a,b", contentType: "text/csv" }],
        },
        defaultFrom: "noreply@acme.example",
      });
      const message = sendMail.mock.calls[0]?.[0] as Record<string, unknown>;

      expect(message).toMatchObject({
        replyTo: "help@acme.example",
        headers: { "X-Report": "weekly" },
        attachments: [{ filename: "report.csv", content: "a,b", contentType: "text/csv" }],
        envelope: { to: ["public@acme.example", "hidden@acme.example"] },
      });
      expect(message).not.toHaveProperty("bcc");
    });
  });

  describe("when the same delivery is attempted again", () => {
    /** @scenario "SMTP retries preserve the notification message identity" */
    it("keeps the MIME message identifier, and gives another delivery another one", async () => {
      const gateway = SmtpEmailGatewayChannel.create({ url: "smtp://localhost:1025" });
      const base = { to: "public@acme.example", subject: "Alert", html: "<p>Alert</p>" };
      for (const idempotencyKey of ["org:join:a", "org:join:a", "org:join:b"]) {
        await gateway.send({
          content: { ...base, idempotencyKey },
          defaultFrom: "noreply@acme.example",
        });
      }
      const [first, retry, other] = sendMail.mock.calls.map(
        (call) => call[0] as { messageId: string },
      );

      expect(first?.messageId).toMatch(/^<[a-f0-9]{64}@notifications\.langwatch\.ai>$/);
      expect(retry?.messageId).toBe(first?.messageId);
      expect(other?.messageId).not.toBe(first?.messageId);
      expect(first).not.toHaveProperty("idempotencyKey");
    });
  });
});
