/**
 * The six join-request mails over notification's sender.
 * Spec: modules/identity/specs/join-request-worker-composition.feature
 */
import {
  type EmailContent,
  joinRequestExpiredSubject,
  joinRequestReminderSubject,
  renderJoinRequestExpiredEmail,
  renderJoinRequestReminderEmail,
} from "@langwatch/mail";
import { describe, expect, it } from "vitest";

import { SesJoinRequestNotificationMailChannel } from "../ses.join-request-notification-mail.channel.ts";

describe("SesJoinRequestNotificationMailChannel", () => {
  describe("when each of the six mails is sent with a delivery key", () => {
    /** @scenario "Each join-request mail carries a delivery key naming its notice and its recipient" */
    it("hands the sender that key intact", async () => {
      const sent: EmailContent[] = [];
      const channel = SesJoinRequestNotificationMailChannel.create({
        mailer: {
          send: async (content) => {
            sent.push(content);
          },
        },
        baseUrl: "https://app.langwatch.test",
      });
      const admin = { adminEmail: "priya@acme.example", organizationName: "Acme" };
      const requester = { requesterEmail: "morgan@acme.example", organizationName: "Acme" };

      await channel.sendRequestArrived({
        ...admin,
        requesterName: "Morgan",
        domain: "acme.example",
        idempotencyKey: "key-arrived",
      });
      await channel.sendRequestStillWaiting({
        ...admin,
        requesterName: "Morgan",
        idempotencyKey: "key-waiting",
      });
      await channel.sendRequestApproved({ ...requester, idempotencyKey: "key-approved" });
      await channel.sendRequestRejected({ ...requester, idempotencyKey: "key-rejected" });
      await channel.sendRequestExpired({ ...requester, idempotencyKey: "key-expired" });
      await channel.sendJoinedAutomatically({
        ...admin,
        memberName: "Morgan",
        domain: "acme.example",
        idempotencyKey: "key-joined",
      });

      expect(sent.map((content) => content.idempotencyKey)).toEqual([
        "key-arrived",
        "key-waiting",
        "key-approved",
        "key-rejected",
        "key-expired",
        "key-joined",
      ]);
    });
  });

  describe("when the reminder goes to an administrator", () => {
    /** @scenario "Identity sends the reminder in the mail package's own wording" */
    it("sends the mail package's reminder, linking the deployment's members settings", async () => {
      const { channel, sent } = recordingChannel();

      await channel.sendRequestStillWaiting({
        adminEmail: "priya@acme.example",
        organizationName: "Acme",
        requesterName: "Morgan",
      });

      const props = {
        organizationName: "Acme",
        requesterName: "Morgan",
        membersSettingsUrl: "https://app.langwatch.test/settings/members",
      };
      expect(sent).toHaveLength(1);
      expect(sent[0]?.to).toBe("priya@acme.example");
      expect(sent[0]?.subject).toBe(joinRequestReminderSubject(props));
      expect(sent[0]?.html).toBe(await renderJoinRequestReminderEmail(props));
      expect(sent[0]?.html).toContain('href="https://app.langwatch.test/settings/members"');
      expect(sent[0]?.html).not.toMatch(/approve|reject|decline/i);
    });
  });

  describe("when the lapse notice goes to the requester", () => {
    /** @scenario "Identity sends the lapse notice in the mail package's own wording" */
    it("sends the mail package's lapse notice, naming nobody and giving no reason", async () => {
      const { channel, sent } = recordingChannel();

      await channel.sendRequestExpired({
        requesterEmail: "morgan@acme.example",
        organizationName: "Acme",
      });

      expect(sent).toHaveLength(1);
      expect(sent[0]?.to).toBe("morgan@acme.example");
      expect(sent[0]?.subject).toBe(joinRequestExpiredSubject({ organizationName: "Acme" }));
      expect(sent[0]?.html).toBe(await renderJoinRequestExpiredEmail({ organizationName: "Acme" }));
      expect(sent[0]?.html).not.toContain("morgan@acme.example");
      expect(sent[0]?.html).not.toMatch(/because|reason/i);
    });
  });
});

function recordingChannel() {
  const sent: EmailContent[] = [];
  const channel = SesJoinRequestNotificationMailChannel.create({
    mailer: {
      send: async (content) => {
        sent.push(content);
      },
    },
    baseUrl: "https://app.langwatch.test",
  });
  return { channel, sent };
}
