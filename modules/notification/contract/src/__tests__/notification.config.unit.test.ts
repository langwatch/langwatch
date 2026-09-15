import { RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { notificationServerConfigDefinition } from "../notification.config.ts";

describe("notification server configuration", () => {
  describe("given a deployment selects one of the mail transports", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads every transport's leaves through one block", () => {
      const value = RuntimeConfig.create({
        name: "notification",
        definition: notificationServerConfigDefinition,
        source: {
          EMAIL_PROVIDER: "smtp",
          SMTP_HOST: "smtp.acme.test",
          SMTP_PORT: "587",
          SENDGRID_API_KEY: "sg-key",
          RESEND_API_KEY: "re-key",
        },
      }).value;

      expect(value.provider).toBe("smtp");
      expect(value.smtp).toMatchObject({ host: "smtp.acme.test", port: "587" });
      expect(value.sendgrid.apiKey).toBe("sg-key");
      expect(value.resend.apiKey).toBe("re-key");
    });
  });
});
