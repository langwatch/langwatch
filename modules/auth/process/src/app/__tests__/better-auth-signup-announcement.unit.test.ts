import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it, vi } from "vitest";

import { MemorySignupAnnouncementChannel } from "../../channels/memory/memory.auth.channels.ts";
import type { SignupAnnouncementChannel } from "../../channels/signup-announcement.channel.ts";
import { SlackSignupAnnouncementChannel } from "../../channels/slack/slack.signup-announcement.channel.ts";
import { SignupAnnouncementService } from "../../services/signup-announcement.service.ts";
import { LoggedBetterAuthAnnouncements } from "../auth.app.ts";

const arrival = {
  userId: "user_jane",
  userName: "Jane Doe",
  userEmail: "jane@acme.example",
  organizationId: "org_acme",
  organizationName: "Acme",
};

function announcementsOver(channel: SignupAnnouncementChannel) {
  const { logger, lines } = createTestLogger();
  const signups = SignupAnnouncementService.create({
    channel,
    publicBaseUrl: "https://app.langwatch.ai",
    logger,
  });
  return {
    announcements: LoggedBetterAuthAnnouncements.create({
      logger,
      signups,
      lifecycle: { signedUp: vi.fn(), sessionStarted: vi.fn(), ssoAutoAdded: vi.fn() },
    }),
    lines,
  };
}

describe("LoggedBetterAuthAnnouncements.announceSignup()", () => {
  describe("when somebody joins an organization through its domain", () => {
    /** @scenario "Joining through a domain or an SSO connection is announced too" */
    it("posts the join card to our own sign-ups channel", async () => {
      const channel = MemorySignupAnnouncementChannel.create();
      const { announcements } = announcementsOver(channel);

      announcements.announceSignup(arrival);

      await vi.waitFor(() => expect(channel.posted).toHaveLength(1));
      expect(channel.posted[0]?.text).toBe("👋 Jane Doe joined Acme · jane@acme.example · via SSO");
    });
  });

  describe("when the Slack post fails", () => {
    it("reports it and never throws into the sign-in", async () => {
      const channel = SlackSignupAnnouncementChannel.create({
        webhookUrl: "https://hooks.slack.com/services/test",
        createWebhook: () => ({
          send: () => Promise.reject(new Error("slack down")),
        }),
      });
      const { announcements, lines } = announcementsOver(channel);

      expect(() => announcements.announceSignup(arrival)).not.toThrow();

      await vi.waitFor(() =>
        expect(lines.findLine("error", "Better Auth swallowed an error")).toBeDefined(),
      );
    });
  });
});
