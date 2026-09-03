import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMailMock, closeMock, createTransportMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn(),
  closeMock: vi.fn(),
  createTransportMock: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

import { buildSmtpTransportOptions, SmtpEmailProvider } from "../smtp";
import { EmailProviderConfigurationError } from "../types";
import type { MailerConfiguration } from "../types";

const sentMessage = () => sendMailMock.mock.calls[0]?.[0];

const smtpConfig = (
  overrides: Partial<MailerConfiguration["smtp"]> = {},
): MailerConfiguration["smtp"] => ({ ...overrides });

describe("buildSmtpTransportOptions", () => {
  describe("given a connection URL", () => {
    it("uses the URL directly", () => {
      expect(
        buildSmtpTransportOptions(smtpConfig({ url: "smtps://user:pass@relay.corp:465" })),
      ).toMatchObject({
        url: "smtps://user:pass@relay.corp:465",
      });
    });

    it("prefers the URL over discrete settings", () => {
      expect(
        buildSmtpTransportOptions(smtpConfig({ url: "smtp://localhost:1025", host: "other.host" })),
      ).toMatchObject({
        url: "smtp://localhost:1025",
      });
    });
  });

  describe("given discrete host settings", () => {
    it("defaults to port 587 with STARTTLS", () => {
      expect(buildSmtpTransportOptions(smtpConfig({ host: "relay.corp" }))).toMatchObject({
        host: "relay.corp",
        port: 587,
        secure: false,
      });
    });

    it("treats port 465 as implicit TLS", () => {
      expect(
        buildSmtpTransportOptions(smtpConfig({ host: "relay.corp", port: "465" })),
      ).toMatchObject({
        port: 465,
        secure: true,
      });
    });

    it("lets SMTP_SECURE override the port-based default", () => {
      expect(
        buildSmtpTransportOptions(smtpConfig({ host: "relay.corp", port: "465", secure: "false" })),
      ).toMatchObject({ secure: false });
    });

    it("includes credentials when a user is set", () => {
      expect(
        buildSmtpTransportOptions(
          smtpConfig({ host: "relay.corp", user: "mailer", password: "secret" }),
        ),
      ).toMatchObject({
        auth: { user: "mailer", pass: "secret" },
      });
    });

    it("omits auth entirely for an unauthenticated internal relay", () => {
      expect(buildSmtpTransportOptions(smtpConfig({ host: "relay.corp" }))).not.toHaveProperty(
        "auth",
      );
    });
  });

  describe("given no host at all", () => {
    it("fails with an actionable error", () => {
      expect(() => buildSmtpTransportOptions(smtpConfig({}))).toThrow(
        EmailProviderConfigurationError,
      );
    });
  });

  describe("given a non-numeric port", () => {
    it("fails rather than silently dialling NaN", () => {
      expect(() =>
        buildSmtpTransportOptions(smtpConfig({ host: "relay.corp", port: "not-a-port" })),
      ).toThrow(/SMTP_PORT/);
    });
  });
});

describe("SmtpEmailProvider.send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMailMock.mockResolvedValue({ messageId: "<abc@localhost>" });
    createTransportMock.mockReturnValue({
      sendMail: sendMailMock,
      close: closeMock,
    });
  });

  const makeProvider = () => SmtpEmailProvider.create(smtpConfig({ url: "smtp://localhost:1025" }));

  describe("given a plain message", () => {
    /** @scenario "Every supported gateway can be selected" */
    it("sends the html body with the default sender", async () => {
      await makeProvider().send({
        content: { to: "user@example.com", subject: "Hi", html: "<p>Hi</p>" },
        defaultFrom: "LangWatch <noreply@langwatch.ai>",
      });

      expect(sentMessage()).toMatchObject({
        from: "LangWatch <noreply@langwatch.ai>",
        to: ["user@example.com"],
        subject: "Hi",
        html: "<p>Hi</p>",
      });
    });

    it("closes the transport so connections are not leaked", async () => {
      const provider = makeProvider();
      await provider.send({
        content: { to: "user@example.com", subject: "Hi", html: "<p>Hi</p>" },
        defaultFrom: "noreply@langwatch.ai",
      });
      await provider.close();

      expect(closeMock).toHaveBeenCalled();
    });
  });

  describe("given the full message surface", () => {
    /** @scenario "The full message surface survives every gateway" */
    it("maps blind copies, reply-to, custom headers and attachments", async () => {
      await makeProvider().send({
        content: {
          to: ["a@example.com", "b@example.com"],
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

      expect(sentMessage()).toMatchObject({
        to: ["a@example.com", "b@example.com"],
        replyTo: "support@langwatch.ai",
        headers: { "List-Unsubscribe": "<https://x/unsub>" },
        attachments: [
          {
            filename: "report.csv",
            content: "a,b\n1,2",
            contentType: "text/csv",
          },
        ],
      });
    });

    // Passing `bcc` to nodemailer renders a real Bcc header, which would leak
    // every blind recipient to everyone on the message. Delivery must ride the
    // SMTP envelope instead.
    it("keeps blind recipients out of the message fields entirely", async () => {
      await makeProvider().send({
        content: {
          to: "a@example.com",
          bcc: "hidden@example.com",
          subject: "Alert",
          html: "<p>Alert</p>",
        },
        defaultFrom: "noreply@langwatch.ai",
      });

      expect(sentMessage()).not.toHaveProperty("bcc");
    });

    it("delivers blind recipients through the SMTP envelope", async () => {
      await makeProvider().send({
        content: {
          to: ["a@example.com"],
          bcc: ["hidden@example.com", "hidden2@example.com"],
          subject: "Alert",
          html: "<p>Alert</p>",
        },
        defaultFrom: "noreply@langwatch.ai",
      });

      expect(sentMessage().envelope).toEqual({
        from: "noreply@langwatch.ai",
        to: ["a@example.com", "hidden@example.com", "hidden2@example.com"],
      });
    });

    it("builds the envelope from an explicit sender, not the default", async () => {
      await makeProvider().send({
        content: {
          to: "a@example.com",
          bcc: ["hidden@example.com"],
          from: "alerts@acme.com",
          subject: "Alert",
          html: "<p>Alert</p>",
        },
        defaultFrom: "noreply@langwatch.ai",
      });

      expect(sentMessage().envelope).toEqual({
        from: "alerts@acme.com",
        to: ["a@example.com", "hidden@example.com"],
      });
    });

    it("leaves the envelope to nodemailer when there are no blind recipients", async () => {
      await makeProvider().send({
        content: {
          to: "a@example.com",
          subject: "Alert",
          html: "<p>Alert</p>",
        },
        defaultFrom: "noreply@langwatch.ai",
      });

      expect(sentMessage()).not.toHaveProperty("envelope");
    });

    it("strips line breaks from custom headers to block injection", async () => {
      await makeProvider().send({
        content: {
          to: "a@example.com",
          subject: "Alert",
          html: "<p>Alert</p>",
          headers: { "X-Custom": "value\r\nBcc: attacker@evil.com" },
        },
        defaultFrom: "noreply@langwatch.ai",
      });

      expect(sentMessage().headers["X-Custom"]).toBe("value Bcc: attacker@evil.com");
    });
  });

  describe("given an explicit sender", () => {
    it("overrides the default from address", async () => {
      await makeProvider().send({
        content: {
          to: "a@example.com",
          from: "alerts@acme.com",
          subject: "Alert",
          html: "<p>Alert</p>",
        },
        defaultFrom: "noreply@langwatch.ai",
      });

      expect(sentMessage().from).toBe("alerts@acme.com");
    });
  });

  describe("given the relay rejects the message", () => {
    it("propagates the failure and still closes the transport", async () => {
      sendMailMock.mockRejectedValue(new Error("relay refused"));
      const provider = makeProvider();

      await expect(
        provider.send({
          content: {
            to: "a@example.com",
            subject: "Alert",
            html: "<p>Alert</p>",
          },
          defaultFrom: "noreply@langwatch.ai",
        }),
      ).rejects.toThrow("relay refused");
      await provider.close();
      expect(closeMock).toHaveBeenCalled();
    });
  });
});
