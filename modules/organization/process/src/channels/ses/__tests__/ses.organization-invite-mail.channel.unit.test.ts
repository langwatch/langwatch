/**
 * The invitation mails over notification's sender.
 * Spec: modules/organization/specs/invitations.feature
 */
import type { EmailContent } from "@langwatch/mail";
import { describe, expect, it, vi } from "vitest";

import { SesOrganizationInviteMailChannel } from "../ses.organization-invite-mail.channel.ts";

function channelOver({ provider }: { provider: string | undefined }) {
  const sent: EmailContent[] = [];
  const notifications = {
    getMailDelivery: async () => ({ provider, smtpConfigured: false, misconfigured: false }),
    sendEmail: vi.fn(async (content: EmailContent) => {
      sent.push(content);
    }),
  };

  return { channel: SesOrganizationInviteMailChannel.create({ notifications }), sent };
}

describe("SesOrganizationInviteMailChannel", () => {
  describe("when a gateway is named", () => {
    /** @scenario "An invitation is emailed through notification with its accept link" */
    it("sends the invitee one mail carrying the accept link", async () => {
      const { channel, sent } = channelOver({ provider: "smtp" });

      await channel.sendInvite({
        email: "morgan@acme.example",
        organization: { name: "Acme Corp" },
        acceptInviteUrl: "https://app.langwatch.test/invite/accept?inviteCode=abc",
      });

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        to: "morgan@acme.example",
        subject: "You were added to Acme Corp on LangWatch",
      });
      expect(sent[0]?.html).toContain("https://app.langwatch.test/invite/accept?inviteCode=abc");
    });

    /** @scenario "An invitee's request for a fresh invitation emails each administrator" */
    it("sends each administrator one mail naming the invited address", async () => {
      const { channel, sent } = channelOver({ provider: "smtp" });
      const request = {
        organizationName: "Acme Corp",
        invitedEmail: "morgan@acme.example",
        membersSettingsUrl: "https://app.langwatch.test/settings/members",
      };

      await channel.sendInviteReRequest({ ...request, adminEmail: "one@acme.example" });
      await channel.sendInviteReRequest({ ...request, adminEmail: "two@acme.example" });

      expect(sent.map((content) => content.to)).toEqual(["one@acme.example", "two@acme.example"]);
      expect(sent[0]?.html).toContain("morgan@acme.example");
    });
  });

  describe("when no gateway is named", () => {
    /** @scenario "An invitation reports it was not emailed when no gateway is named" */
    it("refuses the send so the invitation reports its email was not sent", async () => {
      const { channel, sent } = channelOver({ provider: undefined });

      await expect(
        channel.sendInvite({
          email: "morgan@acme.example",
          organization: { name: "Acme Corp" },
          acceptInviteUrl: "https://app.langwatch.test/invite/accept?inviteCode=abc",
        }),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      expect(sent).toHaveLength(0);
    });
  });
});
