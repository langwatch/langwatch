import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { MemorySignupAnnouncementChannel } from "../../channels/memory/memory.signup-announcement.channel.ts";
import { SignupAnnouncementService } from "../signup-announcement.service.ts";

const signup = {
  userName: "Jane Doe",
  userEmail: "jane@example.com",
  organizationName: "Acme Corp",
};

function announcer({ configured }: { configured: boolean }) {
  const channel = MemorySignupAnnouncementChannel.create();
  const { logger, lines } = createTestLogger();
  const service = SignupAnnouncementService.create({
    channel: configured ? channel : undefined,
    publicBaseUrl: "https://app.langwatch.ai",
    logger,
  });
  return { service, channel, lines };
}

describe("SignupAnnouncementService", () => {
  describe("given the sign-ups webhook is configured", () => {
    /** @scenario "Slack notification sent after onboarding creates the organization" */
    /** @scenario "A sign-up posts the new-user notice to the signups channel" */
    it("posts the new-user notice naming the user, their email and the organization", async () => {
      const { service, channel } = announcer({ configured: true });

      await service.announce(signup);

      expect(channel.posted.map((message) => message.text)).toEqual([
        "👋 New user registered · Name: Jane Doe · Email: jane@example.com · Organization: Acme Corp",
      ]);
      expect(JSON.stringify(channel.posted[0]?.blocks)).toContain("app.langwatch.ai");
    });

    /** @scenario "Slack notification includes optional campaign context when present" */
    it("adds the phone number and the campaign the sign-up carried", async () => {
      const { service, channel } = announcer({ configured: true });

      await service.announce({
        ...signup,
        phoneNumber: "+31 20 123 4567",
        signUpData: { utmCampaign: "launch-week" },
      });

      expect(channel.posted[0]?.text).toContain("Phone: +31 20 123 4567 · Campaign: launch-week");
    });

    /** @scenario "Missing optional signup fields do not block the notification" */
    it("posts without the optional fields when the sign-up gave none", async () => {
      const { service, channel } = announcer({ configured: true });

      await service.announce({ ...signup, signUpData: { utmCampaign: 7 } });

      expect(channel.posted).toHaveLength(1);
      expect(channel.posted[0]?.text).not.toContain("Campaign");
      expect(channel.posted[0]?.text).not.toContain("Phone");
    });
  });

  describe("given the sign-ups webhook is not configured", () => {
    /** @scenario "Missing Slack webhook does not block onboarding completion" */
    it("sends nothing, warns once and resolves", async () => {
      const { service, channel, lines } = announcer({ configured: false });

      await expect(service.announce(signup)).resolves.toBeUndefined();

      expect(channel.posted).toEqual([]);
      expect(lines.findLine("warn", "SLACK_CHANNEL_SIGNUPS is not configured")).toBeDefined();
    });
  });
});
