import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, unknown>,
}));

vi.mock("../../../../env.mjs", () => ({ env: mockEnv }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import {
  EmailProviderConfigurationError,
  hasEmailProvider,
  resolveEmailProvider,
} from "../index";

const setEnv = (values: Record<string, unknown>) => {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  Object.assign(mockEnv, values);
};

describe("resolveEmailProvider", () => {
  beforeEach(() => {
    setEnv({});
  });

  describe("given EMAIL_PROVIDER names a configured gateway", () => {
    it.each([
      ["ses", { USE_AWS_SES: "true", AWS_REGION: "eu-central-1" }],
      ["sendgrid", { SENDGRID_API_KEY: "SG.test" }],
      ["smtp", { SMTP_HOST: "smtp.internal" }],
      ["resend", { RESEND_API_KEY: "re_test" }],
    ])("selects %s", (provider, credentials) => {
      setEnv({ EMAIL_PROVIDER: provider, ...credentials });

      expect(resolveEmailProvider()?.name).toBe(provider);
    });

    /** @scenario "Operator picks a provider explicitly" */
    it("accepts a name with surrounding whitespace and mixed case", () => {
      setEnv({ EMAIL_PROVIDER: "  SMTP  ", SMTP_URL: "smtp://localhost:1025" });

      expect(resolveEmailProvider()?.name).toBe("smtp");
    });
  });

  describe("given EMAIL_PROVIDER is set alongside other credentials", () => {
    /** @scenario "A named provider wins over inferred credentials" */
    it("uses the named provider rather than the inferred one", () => {
      setEnv({
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "smtp.internal",
        SENDGRID_API_KEY: "SG.test",
        USE_AWS_SES: "true",
        AWS_REGION: "eu-central-1",
      });

      expect(resolveEmailProvider()?.name).toBe("smtp");
    });
  });

  describe("given EMAIL_PROVIDER is not set", () => {
    /** @scenario "Existing AWS deployments keep working without naming a provider" */
    it("infers SES from the legacy AWS settings", () => {
      setEnv({ USE_AWS_SES: "true", AWS_REGION: "eu-central-1" });

      expect(resolveEmailProvider()?.name).toBe("ses");
    });

    /** @scenario "Existing deployments keep working without naming a provider" */
    it("infers SendGrid from a lone API key", () => {
      setEnv({ SENDGRID_API_KEY: "SG.test" });

      expect(resolveEmailProvider()?.name).toBe("sendgrid");
    });

    it("prefers SES when both legacy providers are configured", () => {
      setEnv({
        USE_AWS_SES: "true",
        AWS_REGION: "eu-central-1",
        SENDGRID_API_KEY: "SG.test",
      });

      expect(resolveEmailProvider()?.name).toBe("ses");
    });

    it("does not infer newer gateways, which must be named explicitly", () => {
      setEnv({ SMTP_HOST: "smtp.internal", RESEND_API_KEY: "re_test" });

      expect(resolveEmailProvider()).toBeNull();
    });

    /** @scenario "No email configuration at all is reported clearly" */
    it("returns null when nothing is configured", () => {
      expect(resolveEmailProvider()).toBeNull();
    });
  });

  describe("given EMAIL_PROVIDER names something unsupported", () => {
    /** @scenario "An unknown provider name is rejected loudly" */
    it("throws an error listing the supported gateways", () => {
      setEnv({ EMAIL_PROVIDER: "carrier-pigeon" });

      expect(() => resolveEmailProvider()).toThrow(EmailProviderConfigurationError);
      expect(() => resolveEmailProvider()).toThrow(/ses, sendgrid, smtp, resend/);
    });
  });

  describe("given EMAIL_PROVIDER names a gateway that is missing credentials", () => {
    it.each([
      ["resend", /RESEND_API_KEY/],
      ["smtp", /SMTP_URL/],
      ["sendgrid", /SENDGRID_API_KEY/],
      ["ses", /AWS_REGION/],
    ])("explains what %s is missing", (provider, expected) => {
      setEnv({ EMAIL_PROVIDER: provider });

      expect(() => resolveEmailProvider()).toThrow(expected);
    });

    /** @scenario "A named provider missing its credentials is rejected loudly" */
    it("does not silently fall back to another configured gateway", () => {
      setEnv({ EMAIL_PROVIDER: "resend", SENDGRID_API_KEY: "SG.test" });

      expect(() => resolveEmailProvider()).toThrow(EmailProviderConfigurationError);
    });
  });
});

describe("hasEmailProvider", () => {
  beforeEach(() => {
    setEnv({});
  });

  describe("given a usable gateway", () => {
    /** @scenario "Email options appear once any gateway is usable" */
    it("reports email as available", () => {
      setEnv({ EMAIL_PROVIDER: "smtp", SMTP_URL: "smtp://localhost:1025" });

      expect(hasEmailProvider()).toBe(true);
    });
  });

  describe("given no configuration", () => {
    /** @scenario "Email options stay hidden when no gateway is usable" */
    it("reports email as unavailable", () => {
      expect(hasEmailProvider()).toBe(false);
    });
  });

  describe("given a misconfigured gateway", () => {
    /** @scenario "A misconfigured gateway does not break the interface" */
    it("reports unavailable instead of throwing, so the UI can still render", () => {
      setEnv({ EMAIL_PROVIDER: "carrier-pigeon" });

      expect(hasEmailProvider()).toBe(false);
    });
  });
});
