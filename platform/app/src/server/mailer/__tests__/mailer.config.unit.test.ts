import { describe, expect, it } from "vitest";
import { resolveMailerConfiguration } from "../mailer.config";

describe("resolveMailerConfiguration", () => {
  it("maps every private delivery setting once and derives the established sender", () => {
    expect(
      resolveMailerConfiguration({
        baseHost: "https://tenant.example.com",
        emailProvider: "smtp",
        useAwsSes: "true",
        awsRegion: "eu-central-1",
        awsSesEndpoint: "https://ses.internal.example",
        sendgridApiKey: "SG.secret",
        smtpUrl: "smtp://relay.example:1025",
        smtpHost: "relay.example",
        smtpPort: "465",
        smtpUser: "mailer",
        smtpPassword: "secret",
        smtpSecure: "true",
        resendApiKey: "re_secret",
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

  it("keeps the established localhost sender default", () => {
    expect(resolveMailerConfiguration({ baseHost: "http://localhost:3000" }).defaultFrom).toBe(
      "LangWatch <contact@langwatch.ai>",
    );
  });
});
