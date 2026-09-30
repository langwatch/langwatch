/**
 * The six join-request mails over notification's sender.
 * Spec: modules/identity/specs/join-request-worker-composition.feature
 */
import type { EmailContent } from "@langwatch/mail";
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
});
