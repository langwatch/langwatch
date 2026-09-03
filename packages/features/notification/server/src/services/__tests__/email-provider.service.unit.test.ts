import { describe, expect, it } from "vitest";
import type { MailerConfiguration } from "../../ports/email-delivery.port";
import { EmailProviderService } from "../email-provider.service";

/**
 * Spec: packages/features/notification/specs/packaged-mail-delivery.feature
 */
const configuration = (overrides: Partial<MailerConfiguration> = {}): MailerConfiguration => ({
  defaultFrom: "LangWatch <contact@langwatch.ai>",
  ses: { enabled: false },
  sendgrid: {},
  smtp: {},
  resend: {},
  ...overrides,
});

describe("given a mailer configuration naming one provider", () => {
  describe("when the gateway is resolved", () => {
    /** @scenario "The gateway named by the deployment is the one that sends" */
    it.each([
      ["ses", configuration({ provider: "ses", ses: { enabled: true, region: "eu-central-1" } })],
      ["sendgrid", configuration({ provider: "sendgrid", sendgrid: { apiKey: "SG.test" } })],
      ["smtp", configuration({ provider: "smtp", smtp: { host: "smtp.internal" } })],
      ["resend", configuration({ provider: "resend", resend: { apiKey: "re_test" } })],
    ])("selects the named %s gateway", (provider, input) => {
      expect(EmailProviderService.create(input).tryResolveName()).toBe(provider);
    });

    /** @scenario "The gateway named by the deployment is the one that sends" */
    it("keeps the explicit name over the legacy inference order", () => {
      expect(
        EmailProviderService.create(
          configuration({
            provider: " smtp ",
            ses: { enabled: true, region: "eu-central-1" },
            sendgrid: { apiKey: "SG.test" },
            smtp: { url: "smtp://localhost:1025" },
          }),
        ).tryResolveName(),
      ).toBe("smtp");
    });

    /** @scenario "The gateway named by the deployment is the one that sends" */
    it("infers only the two gateways the legacy mailer branched on", () => {
      expect(
        EmailProviderService.create(
          configuration({
            ses: { enabled: true, region: "eu-central-1" },
            sendgrid: { apiKey: "SG.test" },
          }),
        ).tryResolveName(),
      ).toBe("ses");
      expect(
        EmailProviderService.create(
          configuration({ smtp: { host: "smtp.internal" }, resend: { apiKey: "re_test" } }),
        ).tryResolveName(),
      ).toBeNull();
    });
  });
});

describe("given a mailer configuration naming a provider whose credentials are absent", () => {
  describe("when the gateway is resolved", () => {
    /** @scenario "A named but unusable gateway refuses instead of falling back" */
    it("refuses naming the setting the operator must supply", () => {
      expect(() =>
        EmailProviderService.create(configuration({ provider: "resend" })).tryResolveName(),
      ).toThrow(/RESEND_API_KEY/);
    });

    /** @scenario "A named but unusable gateway refuses instead of falling back" */
    it("names the alternative rather than sending from an unexpected domain", () => {
      expect(() =>
        EmailProviderService.create(
          configuration({ provider: "resend", sendgrid: { apiKey: "SG.test" } }),
        ).tryResolveName(),
      ).toThrow(/did you mean EMAIL_PROVIDER=sendgrid/);
    });

    /** @scenario "A named but unusable gateway refuses instead of falling back" */
    it("rejects a name no gateway answers to", () => {
      expect(() =>
        EmailProviderService.create(configuration({ provider: "carrier-pigeon" })).tryResolveName(),
      ).toThrow(/ses, sendgrid, smtp, resend/);
    });
  });
});

describe("given a deployment that set no explicit sender address", () => {
  describe("when the sender is derived from the deployment host", () => {
    /**
     * The literals are the twin pin. `resolveMailerDefaultFrom` in
     * `platform/app/src/runtime/app/mailer.private-config.ts` derives the same
     * four answers from the same input, and both graphs send join-request and
     * automation mail while the pipelines are twinned. Two sender addresses
     * for one notification would fail one deployment's SPF and pass the
     * other's, and the half that failed is the half nobody is watching.
     */
    /** @scenario "The sender address a deployment did not name is derived once" */
    it.each([
      ["https://app.langwatch.ai", "LangWatch <contact@langwatch.ai>"],
      ["http://localhost:5560", "LangWatch <contact@langwatch.ai>"],
      ["https://langwatch.acme.example", "LangWatch <mailer@langwatch.acme.example>"],
      ["langwatch.acme.example/base", "LangWatch <mailer@langwatch.acme.example>"],
    ])("derives %s as %s", (baseHost, expected) => {
      expect(EmailProviderService.resolveDefaultFrom({ baseHost })).toBe(expected);
    });

    /** @scenario "The sender address a deployment did not name is derived once" */
    it("prefers the address the deployment named", () => {
      expect(
        EmailProviderService.resolveDefaultFrom({
          baseHost: "https://langwatch.acme.example",
          emailDefaultFrom: "Acme <noreply@acme.example>",
        }),
      ).toBe("Acme <noreply@acme.example>");
    });
  });
});
