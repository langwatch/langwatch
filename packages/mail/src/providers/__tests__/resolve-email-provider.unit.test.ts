import { describe, expect, it } from "vitest";
import {
  EmailProviderConfigurationError,
  hasEmailProvider,
  resolveEmailProviderName,
} from "../index";
import type { MailerConfiguration } from "../types";

/**
 * Builds a configuration the way the process would resolve it from the
 * environment at boot — the shape `resolveEmailProviderName` is tested
 * against directly now that credentials arrive as an explicit parameter
 * rather than a live `env.mjs` read.
 */
const configWith = (overrides: {
  provider?: string;
  useAwsSes?: boolean;
  awsRegion?: string;
  sendgridApiKey?: string;
  smtpUrl?: string;
  smtpHost?: string;
  resendApiKey?: string;
}): MailerConfiguration => ({
  defaultFrom: "noreply@example.com",
  provider: overrides.provider,
  ses: {
    enabled: overrides.useAwsSes ?? false,
    region: overrides.awsRegion,
  },
  sendgrid: { apiKey: overrides.sendgridApiKey },
  smtp: { url: overrides.smtpUrl, host: overrides.smtpHost },
  resend: { apiKey: overrides.resendApiKey },
});

describe("resolveEmailProviderName", () => {
  describe("given EMAIL_PROVIDER names a configured gateway", () => {
    it.each([
      ["ses", { useAwsSes: true, awsRegion: "eu-central-1" }],
      ["sendgrid", { sendgridApiKey: "SG.test" }],
      ["smtp", { smtpHost: "smtp.internal" }],
      ["resend", { resendApiKey: "re_test" }],
    ] as const)("selects %s", (provider, credentials) => {
      expect(resolveEmailProviderName(configWith({ provider, ...credentials }))).toBe(provider);
    });

    /** @scenario "Operator picks a provider explicitly" */
    it("accepts a name with surrounding whitespace and mixed case", () => {
      expect(
        resolveEmailProviderName(
          configWith({ provider: "  SMTP  ", smtpUrl: "smtp://localhost:1025" }),
        ),
      ).toBe("smtp");
    });
  });

  describe("given EMAIL_PROVIDER is set alongside other credentials", () => {
    /** @scenario "A named provider wins over inferred credentials" */
    it("uses the named provider rather than the inferred one", () => {
      expect(
        resolveEmailProviderName(
          configWith({
            provider: "smtp",
            smtpHost: "smtp.internal",
            sendgridApiKey: "SG.test",
            useAwsSes: true,
            awsRegion: "eu-central-1",
          }),
        ),
      ).toBe("smtp");
    });
  });

  describe("given EMAIL_PROVIDER is not set", () => {
    /** @scenario "Existing AWS deployments keep working without naming a provider" */
    it("infers SES from the legacy AWS settings", () => {
      expect(
        resolveEmailProviderName(configWith({ useAwsSes: true, awsRegion: "eu-central-1" })),
      ).toBe("ses");
    });

    /** @scenario "Existing deployments keep working without naming a provider" */
    it("infers SendGrid from a lone API key", () => {
      expect(resolveEmailProviderName(configWith({ sendgridApiKey: "SG.test" }))).toBe(
        "sendgrid",
      );
    });

    it("prefers SES when both legacy providers are configured", () => {
      expect(
        resolveEmailProviderName(
          configWith({ useAwsSes: true, awsRegion: "eu-central-1", sendgridApiKey: "SG.test" }),
        ),
      ).toBe("ses");
    });

    it("does not infer newer gateways, which must be named explicitly", () => {
      expect(
        resolveEmailProviderName(
          configWith({ smtpHost: "smtp.internal", resendApiKey: "re_test" }),
        ),
      ).toBeNull();
    });

    /** @scenario "No email configuration at all is reported clearly" */
    it("returns null when nothing is configured", () => {
      expect(resolveEmailProviderName(configWith({}))).toBeNull();
    });
  });

  describe("given EMAIL_PROVIDER names something unsupported", () => {
    /** @scenario "An unknown provider name is rejected loudly" */
    it("throws an error listing the supported gateways", () => {
      const configuration = configWith({ provider: "carrier-pigeon" });

      expect(() => resolveEmailProviderName(configuration)).toThrow(
        EmailProviderConfigurationError,
      );
      expect(() => resolveEmailProviderName(configuration)).toThrow(/ses, sendgrid, smtp, resend/);
    });
  });

  describe("given EMAIL_PROVIDER names a gateway that is missing credentials", () => {
    it.each([
      ["resend", /RESEND_API_KEY/],
      ["smtp", /SMTP_URL/],
      ["sendgrid", /SENDGRID_API_KEY/],
      ["ses", /AWS_REGION/],
    ] as const)("explains what %s is missing", (provider, expected) => {
      expect(() => resolveEmailProviderName(configWith({ provider }))).toThrow(expected);
    });

    /** @scenario "A named provider missing its credentials is rejected loudly" */
    it("does not silently fall back to another configured gateway", () => {
      expect(() =>
        resolveEmailProviderName(configWith({ provider: "resend", sendgridApiKey: "SG.test" })),
      ).toThrow(EmailProviderConfigurationError);
    });
  });
});

describe("hasEmailProvider", () => {
  describe("given a usable gateway", () => {
    /** @scenario "Email options appear once any gateway is usable" */
    it("reports email as available", () => {
      expect(
        hasEmailProvider(configWith({ provider: "smtp", smtpUrl: "smtp://localhost:1025" })),
      ).toBe(true);
    });
  });

  describe("given no configuration", () => {
    /** @scenario "Email options stay hidden when no gateway is usable" */
    it("reports email as unavailable", () => {
      expect(hasEmailProvider(configWith({}))).toBe(false);
    });
  });

  describe("given a misconfigured gateway", () => {
    /** @scenario "A misconfigured gateway does not break the interface" */
    it("reports unavailable instead of throwing, so the UI can still render", () => {
      expect(hasEmailProvider(configWith({ provider: "carrier-pigeon" }))).toBe(false);
    });
  });
});
