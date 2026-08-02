import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv, sendMailMock, closeMock, createTransportMock } = vi.hoisted(
  () => ({
    mockEnv: {} as Record<string, unknown>,
    sendMailMock: vi.fn(),
    closeMock: vi.fn(),
    createTransportMock: vi.fn(),
  }),
);

vi.mock("../../../../env.mjs", () => ({ env: mockEnv }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

import { buildSmtpTransportOptions, smtpProvider } from "../smtp";
import { EmailProviderConfigurationError } from "../types";

const setEnv = (values: Record<string, unknown>) => {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  Object.assign(mockEnv, values);
};

const sentMessage = () => sendMailMock.mock.calls[0]?.[0];

describe("buildSmtpTransportOptions", () => {
  beforeEach(() => {
    setEnv({});
    vi.clearAllMocks();
  });

  describe("given a connection URL", () => {
    it("uses the URL directly", () => {
      setEnv({ SMTP_URL: "smtps://user:pass@relay.corp:465" });

      expect(buildSmtpTransportOptions()).toBe(
        "smtps://user:pass@relay.corp:465",
      );
    });

    it("prefers the URL over discrete settings", () => {
      setEnv({ SMTP_URL: "smtp://localhost:1025", SMTP_HOST: "other.host" });

      expect(buildSmtpTransportOptions()).toBe("smtp://localhost:1025");
    });
  });

  describe("given discrete host settings", () => {
    it("defaults to port 587 with STARTTLS", () => {
      setEnv({ SMTP_HOST: "relay.corp" });

      expect(buildSmtpTransportOptions()).toEqual({
        host: "relay.corp",
        port: 587,
        secure: false,
      });
    });

    it("treats port 465 as implicit TLS", () => {
      setEnv({ SMTP_HOST: "relay.corp", SMTP_PORT: "465" });

      expect(buildSmtpTransportOptions()).toMatchObject({
        port: 465,
        secure: true,
      });
    });

    it("lets SMTP_SECURE override the port-based default", () => {
      setEnv({
        SMTP_HOST: "relay.corp",
        SMTP_PORT: "465",
        SMTP_SECURE: "false",
      });

      expect(buildSmtpTransportOptions()).toMatchObject({ secure: false });
    });

    it("includes credentials when a user is set", () => {
      setEnv({
        SMTP_HOST: "relay.corp",
        SMTP_USER: "mailer",
        SMTP_PASSWORD: "secret",
      });

      expect(buildSmtpTransportOptions()).toMatchObject({
        auth: { user: "mailer", pass: "secret" },
      });
    });

    it("omits auth entirely for an unauthenticated internal relay", () => {
      setEnv({ SMTP_HOST: "relay.corp" });

      expect(buildSmtpTransportOptions()).not.toHaveProperty("auth");
    });
  });

  describe("given no host at all", () => {
    it("fails with an actionable error", () => {
      setEnv({});

      expect(() => buildSmtpTransportOptions()).toThrow(
        EmailProviderConfigurationError,
      );
    });
  });

  describe("given a non-numeric port", () => {
    it("fails rather than silently dialling NaN", () => {
      setEnv({ SMTP_HOST: "relay.corp", SMTP_PORT: "not-a-port" });

      expect(() => buildSmtpTransportOptions()).toThrow(/SMTP_PORT/);
    });
  });
});

describe("smtpProvider.send", () => {
  beforeEach(() => {
    setEnv({ SMTP_URL: "smtp://localhost:1025" });
    vi.clearAllMocks();
    sendMailMock.mockResolvedValue({ messageId: "<abc@localhost>" });
    createTransportMock.mockReturnValue({
      sendMail: sendMailMock,
      close: closeMock,
    });
  });

  describe("given a plain message", () => {
    it("sends the html body with the default sender", async () => {
      await smtpProvider.send(
        { to: "user@example.com", subject: "Hi", html: "<p>Hi</p>" },
        "LangWatch <noreply@langwatch.ai>",
      );

      expect(sentMessage()).toMatchObject({
        from: "LangWatch <noreply@langwatch.ai>",
        to: ["user@example.com"],
        subject: "Hi",
        html: "<p>Hi</p>",
      });
    });

    it("closes the transport so connections are not leaked", async () => {
      await smtpProvider.send(
        { to: "user@example.com", subject: "Hi", html: "<p>Hi</p>" },
        "noreply@langwatch.ai",
      );

      expect(closeMock).toHaveBeenCalled();
    });
  });

  describe("given the full message surface", () => {
    it("maps blind copies, reply-to, custom headers and attachments", async () => {
      await smtpProvider.send(
        {
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
        "noreply@langwatch.ai",
      );

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
    it("never passes bcc as a message field, which would render a Bcc header", async () => {
      await smtpProvider.send(
        {
          to: "a@example.com",
          bcc: "hidden@example.com",
          subject: "Alert",
          html: "<p>Alert</p>",
        },
        "noreply@langwatch.ai",
      );

      expect(sentMessage()).not.toHaveProperty("bcc");
    });

    it("delivers blind recipients through the SMTP envelope", async () => {
      await smtpProvider.send(
        {
          to: ["a@example.com"],
          bcc: ["hidden@example.com", "hidden2@example.com"],
          subject: "Alert",
          html: "<p>Alert</p>",
        },
        "noreply@langwatch.ai",
      );

      expect(sentMessage().envelope).toEqual({
        from: "noreply@langwatch.ai",
        to: ["a@example.com", "hidden@example.com", "hidden2@example.com"],
      });
    });

    it("leaves the envelope to nodemailer when there are no blind recipients", async () => {
      await smtpProvider.send(
        { to: "a@example.com", subject: "Alert", html: "<p>Alert</p>" },
        "noreply@langwatch.ai",
      );

      expect(sentMessage()).not.toHaveProperty("envelope");
    });

    it("strips line breaks from custom headers to block injection", async () => {
      await smtpProvider.send(
        {
          to: "a@example.com",
          subject: "Alert",
          html: "<p>Alert</p>",
          headers: { "X-Custom": "value\r\nBcc: attacker@evil.com" },
        },
        "noreply@langwatch.ai",
      );

      expect(sentMessage().headers["X-Custom"]).toBe(
        "value Bcc: attacker@evil.com",
      );
    });
  });

  describe("given an explicit sender", () => {
    it("overrides the default from address", async () => {
      await smtpProvider.send(
        {
          to: "a@example.com",
          from: "alerts@acme.com",
          subject: "Alert",
          html: "<p>Alert</p>",
        },
        "noreply@langwatch.ai",
      );

      expect(sentMessage().from).toBe("alerts@acme.com");
    });
  });

  describe("given the relay rejects the message", () => {
    it("propagates the failure and still closes the transport", async () => {
      sendMailMock.mockRejectedValue(new Error("relay refused"));

      await expect(
        smtpProvider.send(
          { to: "a@example.com", subject: "Alert", html: "<p>Alert</p>" },
          "noreply@langwatch.ai",
        ),
      ).rejects.toThrow("relay refused");
      expect(closeMock).toHaveBeenCalled();
    });
  });
});
