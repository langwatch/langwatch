import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { pickMailGateway } from "../mail-gateway.ts";
import { notificationBrowserConfig, notificationConfig } from "../notification.config.ts";

describe("notification server configuration", () => {
  describe("given a deployment selects one of the mail transports", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads every transport's leaves through one block", () => {
      const config = parseProcessConfig({
        owners: [{ name: "notification", config: notificationConfig }],
        environment: {
          EMAIL_PROVIDER: "smtp",
          SMTP_HOST: "smtp.acme.test",
          SMTP_PORT: "587",
        },
      });

      expect(config.notification.provider).toBe("smtp");
      expect(config.notification.smtp).toMatchObject({ host: "smtp.acme.test", port: "587" });
    });
  });

  describe("given the module's mail delivery answer", () => {
    const config = parseProcessConfig({
      owners: [{ name: "notification", config: notificationConfig }],
      environment: {},
    }).notification;
    const answering = (view: { provider?: "sendgrid" }) => ({
      getMailDelivery: async () => ({
        ...view,
        smtpConfigured: false,
        smtpSendsCredentials: false,
        misconfigured: false,
      }),
    });

    it("projects email on when the member names a gateway", async () => {
      const api = answering({ provider: "sendgrid" });

      await expect(notificationBrowserConfig.project(config, api)).resolves.toEqual({
        email: true,
      });
    });

    it("projects email off when the member names none", async () => {
      await expect(notificationBrowserConfig.project(config, answering({}))).resolves.toEqual({
        email: false,
      });
    });
  });

  describe("given the one gateway pick", () => {
    const none = { ses: false, sendgrid: false, smtp: false, resend: false };

    it("infers SendGrid from its credential when no provider is named", () => {
      expect(
        pickMailGateway({ provider: undefined, available: { ...none, sendgrid: true } }),
      ).toEqual({
        gateway: "sendgrid",
      });
    });

    it("refuses a named gateway that has no settings", () => {
      expect(pickMailGateway({ provider: "Resend", available: none })).toEqual({
        refused: "unconfigured",
        wanted: "resend",
      });
    });
  });
});
