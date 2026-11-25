/**
 * The approaching-limit mail over notification's sender.
 * Spec: modules/notification/specs/customer-io-transactional.feature
 */
import type { EmailContent } from "@langwatch/mail";
import { describe, expect, it } from "vitest";

import { SesUsageLimitEmailChannel } from "../ses.usage-limit-email.channel.ts";

describe("SesUsageLimitEmailChannel", () => {
  describe("when the approaching-limit mail is sent", () => {
    /** @scenario "Each routed message's sender names its template" */
    it("names the usage limit's template", async () => {
      const sent: EmailContent[] = [];
      const channel = SesUsageLimitEmailChannel.create({
        send: async (content) => {
          sent.push(content);
        },
      });

      await channel.send({
        to: "admin@acme.example",
        usage: {
          organizationName: "Acme",
          usagePercentage: 90,
          usagePercentageFormatted: "90",
          currentMonthMessagesCount: 9_000,
          maxMonthlyUsageLimit: 10_000,
          crossedThreshold: 90,
          projectUsageData: [{ id: "p1", name: "Project A", messageCount: 9_000 }],
          actionUrl: "https://app.langwatch.test/settings/usage",
          logoUrl: "https://app.langwatch.test/logo.png",
          severity: "warning",
        },
      });

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: "admin@acme.example", template: "usage-limit" });
    });
  });
});
