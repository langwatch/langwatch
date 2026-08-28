import { InvalidRuntimeConfigError } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { resolveAppMailerConfiguration, resolveMailerDefaultFrom } from "../mailer.private-config";

describe("application mailer private configuration", () => {
  it("projects every private delivery setting and derives the established sender", () => {
    expect(
      resolveAppMailerConfiguration({
        BASE_HOST: "https://tenant.example.com",
        EMAIL_PROVIDER: "smtp",
        USE_AWS_SES: "true",
        AWS_REGION: "eu-central-1",
        AWS_SES_ENDPOINT: "https://ses.internal.example",
        SENDGRID_API_KEY: "SG.secret",
        SMTP_URL: "smtp://relay.example:1025",
        SMTP_HOST: "relay.example",
        SMTP_PORT: "465",
        SMTP_USER: "mailer",
        SMTP_PASSWORD: "secret",
        SMTP_SECURE: "true",
        RESEND_API_KEY: "re_secret",
        UNRELATED_SECRET: "must-not-cross-the-boundary",
      }),
    ).toEqual({
      defaultFrom: "LangWatch <mailer@tenant.example.com>",
      provider: "smtp",
      ses: {
        enabled: true,
        region: "eu-central-1",
        endpoint: "https://ses.internal.example",
      },
      sendgrid: { apiKey: "SG.secret" },
      smtp: {
        url: "smtp://relay.example:1025",
        host: "relay.example",
        port: "465",
        user: "mailer",
        password: "secret",
        secure: "true",
      },
      resend: { apiKey: "re_secret" },
    });
  });

  it("preserves compatibility values for provider resolution", () => {
    const configuration = resolveAppMailerConfiguration({
      BASE_HOST: "http://localhost:3000",
      USE_AWS_SES: "false",
      SMTP_PORT: "not-an-integer",
      SMTP_SECURE: "TRUE",
      EMAIL_PROVIDER: " SMTP ",
      SENDGRID_API_KEY: "",
    });

    expect(configuration).toMatchObject({
      defaultFrom: "LangWatch <contact@langwatch.ai>",
      provider: " SMTP ",
      ses: { enabled: true },
      sendgrid: { apiKey: "" },
      smtp: { port: "not-an-integer", secure: "TRUE" },
    });
  });

  it("fails at the private configuration boundary when the application origin is absent", () => {
    let caught: unknown;
    try {
      resolveAppMailerConfiguration({ SENDGRID_API_KEY: "secret-mail-key" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(InvalidRuntimeConfigError);
    expect(caught).toMatchObject({
      runtime: "application mailer",
      issues: [{ path: "baseHost", code: "invalid_type" }],
    });
    expect(String(caught)).not.toContain("secret-mail-key");
  });

  it("keeps the established sender fallbacks", () => {
    expect(resolveMailerDefaultFrom({ baseHost: "http://localhost:3000" })).toBe(
      "LangWatch <contact@langwatch.ai>",
    );
    expect(resolveMailerDefaultFrom({ baseHost: "not-a-url" })).toBe(
      "LangWatch <mailer@not-a-url>",
    );
  });
});
