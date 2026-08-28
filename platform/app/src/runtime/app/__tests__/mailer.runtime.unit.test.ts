import { beforeEach, describe, expect, it, vi } from "vitest";

const { close, create, send } = vi.hoisted(() => ({
  close: vi.fn(),
  create: vi.fn(),
  send: vi.fn(),
}));

vi.mock("~/server/mailer/providers/smtp", () => ({
  SmtpEmailProvider: { create },
}));

import { AppMailerRuntime } from "../mailer.runtime";
import { AppAwsClientConfiguration } from "../aws-client.composition";
import type { MailerConfiguration } from "~/server/mailer/providers/types";

const configuration: MailerConfiguration = {
  defaultFrom: "noreply@example.com",
  provider: "smtp",
  ses: { enabled: false },
  sendgrid: {},
  smtp: { url: "smtp://relay.example" },
  resend: {},
};

describe("AppMailerRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    create.mockReturnValue({ name: "smtp", send, close });
  });

  it("constructs the selected provider once and reuses it for delivery", async () => {
    const mailer = AppMailerRuntime.create({
      configuration,
      aws: AppAwsClientConfiguration.create({}),
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
    const mailer = AppMailerRuntime.create({
      configuration,
      aws: AppAwsClientConfiguration.create({}),
      outboundProxy: {},
    });
    await mailer.send({ to: "first@example.com", subject: "first", html: "<p>first</p>" });

    await expect(mailer.close()).rejects.toBe(failure);
    await expect(mailer.close()).rejects.toBe(failure);
    await expect(
      mailer.send({ to: "second@example.com", subject: "second", html: "<p>second</p>" }),
    ).rejects.toThrow("Mailer runtime is closed");
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not construct a provider when the process has no configured mail gateway", async () => {
    const mailer = AppMailerRuntime.create({
      configuration: {
        defaultFrom: "noreply@example.com",
        ses: { enabled: false },
        sendgrid: {},
        smtp: {},
        resend: {},
      },
      aws: AppAwsClientConfiguration.create({}),
      outboundProxy: {},
    });

    await expect(
      mailer.send({ to: "recipient@example.com", subject: "subject", html: "<p>body</p>" }),
    ).rejects.toThrow("No email sending method available");

    await expect(mailer.close()).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });
});
