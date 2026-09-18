import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { notificationConfig } from "../notification.config.ts";

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
});
