import { beforeEach, describe, expect, it, vi } from "vitest";

const { close, createTransport, sendMail } = vi.hoisted(() => ({
  close: vi.fn(),
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({ default: { createTransport } }));

import { buildSmtpTransportOptions, SmtpEmailProvider } from "../smtp";
import { EmailProviderConfigurationError } from "../types";

describe("SmtpEmailProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMail.mockResolvedValue({ messageId: "message" });
    createTransport.mockReturnValue({ sendMail, close });
  });

  it("retains URL precedence and discrete transport validation", () => {
    expect(
      buildSmtpTransportOptions({ url: "smtp://localhost:1025", host: "ignored.example" }),
    ).toMatchObject({ url: "smtp://localhost:1025" });
    expect(buildSmtpTransportOptions({ host: "relay.example", port: "465" })).toMatchObject({
      host: "relay.example",
      port: 465,
      secure: true,
    });
    expect(() => buildSmtpTransportOptions({ host: "relay.example", port: "bad" })).toThrow(
      /SMTP_PORT/,
    );
  });

  it("uses the documented default port, secure override, and relay credentials", () => {
    expect(buildSmtpTransportOptions({ host: "relay.example" })).toMatchObject({
      port: 587,
      secure: false,
    });
    expect(
      buildSmtpTransportOptions({
        host: "relay.example",
        port: "465",
        secure: "false",
        user: "mailer",
        password: "secret",
      }),
    ).toMatchObject({ secure: false, auth: { user: "mailer", pass: "secret" } });
    expect(() => buildSmtpTransportOptions({})).toThrow(EmailProviderConfigurationError);
  });

  it("reuses one process transport and preserves invisible BCC delivery", async () => {
    const provider = SmtpEmailProvider.create({ url: "smtp://localhost:1025" });
    await provider.send({
      content: {
        to: ["public@example.com"],
        bcc: ["hidden@example.com"],
        subject: "Alert",
        html: "<p>Alert</p>",
        headers: { "List-Unsubscribe": "<https://example.com/unsubscribe>" },
      },
      defaultFrom: "noreply@example.com",
    });
    await provider.send({
      content: { to: "second@example.com", subject: "Second", html: "<p>Second</p>" },
      defaultFrom: "noreply@example.com",
    });

    expect(createTransport).toHaveBeenCalledOnce();
    expect(sendMail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        envelope: { from: "noreply@example.com", to: ["public@example.com", "hidden@example.com"] },
      }),
    );
    expect(sendMail.mock.calls[0]?.[0]).not.toHaveProperty("bcc");
    await provider.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("preserves sender override, reply-to, attachments, and sanitized headers", async () => {
    const provider = SmtpEmailProvider.create({ url: "smtp://localhost:1025" });
    await provider.send({
      content: {
        from: "alerts@example.com",
        to: "public@example.com",
        subject: "Alert",
        html: "<p>Alert</p>",
        replyTo: "help@example.com",
        headers: { "X-Trace": "clean\r\nBcc: injected@example.com" },
        attachments: [{ filename: "report.csv", content: "a,b", contentType: "text/csv" }],
      },
      defaultFrom: "noreply@example.com",
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "alerts@example.com",
        replyTo: "help@example.com",
        headers: { "X-Trace": "clean Bcc: injected@example.com" },
        attachments: [{ filename: "report.csv", content: "a,b", contentType: "text/csv" }],
      }),
    );
  });

  it("does not manufacture an envelope when BCC is absent and propagates rejection", async () => {
    sendMail.mockRejectedValueOnce(new Error("relay unavailable"));
    const provider = SmtpEmailProvider.create({ url: "smtp://localhost:1025" });
    await expect(
      provider.send({
        content: { to: "public@example.com", subject: "Alert", html: "<p>Alert</p>" },
        defaultFrom: "noreply@example.com",
      }),
    ).rejects.toThrow("relay unavailable");
    expect(sendMail.mock.calls[0]?.[0]).not.toHaveProperty("envelope");
  });
});
