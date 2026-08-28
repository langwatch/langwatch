import { describe, expect, it } from "vitest";
import { hasEmailProvider, resolveEmailProviderName } from "../index";
import type { MailerConfiguration } from "../types";

const configuration = (overrides: Partial<MailerConfiguration> = {}): MailerConfiguration => ({
  defaultFrom: "LangWatch <contact@langwatch.ai>",
  ses: { enabled: false },
  sendgrid: {},
  smtp: {},
  resend: {},
  ...overrides,
});

describe("resolveEmailProviderName", () => {
  it.each([
    ["ses", configuration({ provider: "ses", ses: { enabled: true, region: "eu-central-1" } })],
    ["sendgrid", configuration({ provider: "sendgrid", sendgrid: { apiKey: "SG.test" } })],
    ["smtp", configuration({ provider: "smtp", smtp: { host: "smtp.internal" } })],
    ["resend", configuration({ provider: "resend", resend: { apiKey: "re_test" } })],
  ])("selects configured %s", (provider, input) => {
    expect(resolveEmailProviderName(input)).toBe(provider);
  });

  it("preserves explicit selection and legacy inference order", () => {
    expect(
      resolveEmailProviderName(
        configuration({
          provider: " smtp ",
          ses: { enabled: true, region: "eu-central-1" },
          sendgrid: { apiKey: "SG.test" },
          smtp: { url: "smtp://localhost:1025" },
        }),
      ),
    ).toBe("smtp");
    expect(
      resolveEmailProviderName(
        configuration({
          ses: { enabled: true, region: "eu-central-1" },
          sendgrid: { apiKey: "SG.test" },
        }),
      ),
    ).toBe("ses");
  });

  it("does not infer newer gateways", () => {
    expect(
      resolveEmailProviderName(
        configuration({ smtp: { host: "smtp.internal" }, resend: { apiKey: "re_test" } }),
      ),
    ).toBeNull();
  });

  it("rejects an unknown or selected but incomplete provider", () => {
    expect(() => resolveEmailProviderName(configuration({ provider: "carrier-pigeon" }))).toThrow(
      /ses, sendgrid, smtp, resend/,
    );
    expect(() => resolveEmailProviderName(configuration({ provider: "resend" }))).toThrow(
      /RESEND_API_KEY/,
    );
  });

  it("reports a misconfigured provider as unavailable", () => {
    expect(hasEmailProvider(configuration({ provider: "carrier-pigeon" }))).toBe(false);
  });
});
