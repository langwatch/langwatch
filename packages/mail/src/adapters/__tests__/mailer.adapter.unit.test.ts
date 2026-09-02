import { beforeEach, describe, expect, it, vi } from "vitest";

const { close, create, send } = vi.hoisted(() => ({
  close: vi.fn(),
  create: vi.fn(),
  send: vi.fn(),
}));

vi.mock("../../providers/smtp", () => ({
  SmtpEmailProvider: { create },
}));

import { MailerAdapter } from "../mailer.adapter";
import type { SesAwsClientConfiguration } from "../../providers/ses";
import type { MailerConfiguration } from "../../providers/types";

/**
 * SES is never selected in this suite — the configuration names SMTP — so the
 * AWS half is a shape that refuses if anything reaches it, rather than a real
 * client configuration this package has no business building.
 */
const testAws: SesAwsClientConfiguration = {
  build: () => {
    throw new Error("this suite selects SMTP, so nothing should build an SES client");
  },
};

const configuration: MailerConfiguration = {
  defaultFrom: "noreply@example.com",
  provider: "smtp",
  ses: { enabled: false },
  sendgrid: {},
  smtp: { url: "smtp://relay.example" },
  resend: {},
};

describe("MailerAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    create.mockReturnValue({ name: "smtp", send, close });
  });

  it("constructs the selected provider once and reuses it for delivery", async () => {
    const mailer = MailerAdapter.create({
      configuration,
      aws: testAws,
      outboundProxy: {},
    });

    await mailer.send({ to: "first@example.com", subject: "first", html: "<p>first</p>" });
    await mailer.send({ to: "second@example.com", subject: "second", html: "<p>second</p>" });

    expect(create).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, {
      content: { to: "first@example.com", subject: "first", html: "<p>first</p>" },
      defaultFrom: "noreply@example.com",
    });
  });

  it("closes once, retains close failure, and rejects later sends", async () => {
    const failure = new Error("close failed");
    close.mockRejectedValue(failure);
    const mailer = MailerAdapter.create({
      configuration,
      aws: testAws,
      outboundProxy: {},
    });
    await mailer.send({ to: "first@example.com", subject: "first", html: "<p>first</p>" });

    await expect(mailer.close()).rejects.toBe(failure);
    await expect(mailer.close()).rejects.toBe(failure);
    await expect(
      mailer.send({ to: "second@example.com", subject: "second", html: "<p>second</p>" }),
    ).rejects.toThrow("Mailer is closed");
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not construct a provider when the process has no configured mail gateway", async () => {
    const mailer = MailerAdapter.create({
      configuration: {
        defaultFrom: "noreply@example.com",
        ses: { enabled: false },
        sendgrid: {},
        smtp: {},
        resend: {},
      },
      aws: testAws,
      outboundProxy: {},
    });

    await expect(
      mailer.send({ to: "recipient@example.com", subject: "subject", html: "<p>body</p>" }),
    ).rejects.toThrow("No email sending method available");

    await expect(mailer.close()).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });
});
