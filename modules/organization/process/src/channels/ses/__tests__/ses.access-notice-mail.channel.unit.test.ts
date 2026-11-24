/**
 * The seat request mail over notification's sender.
 * Spec: modules/notification/specs/customer-io-transactional.feature
 */
import type { EmailContent } from "@langwatch/mail";
import { describe, expect, it } from "vitest";

import { SesAccessNoticeMailChannel } from "../ses.access-notice-mail.channel.ts";

describe("SesAccessNoticeMailChannel", () => {
  describe("when a seat request is mailed", () => {
    /** @scenario "Each routed message's sender names its template" */
    it("names the seat request's template", async () => {
      const sent: EmailContent[] = [];
      const channel = SesAccessNoticeMailChannel.create({
        notifications: {
          getMailDelivery: async () => ({
            provider: "smtp",
            smtpConfigured: true,
            smtpSendsCredentials: false,
            misconfigured: false,
          }),
          sendEmail: async (content: EmailContent) => {
            sent.push(content);
          },
        },
      });

      await channel.sendSeatRequest({
        recipientEmail: "priya@acme.example",
        organizationName: "Acme Corp",
        personName: "Morgan",
        personEmail: "morgan@acme.example",
        heldWithoutAccess: true,
        idpRefused: null,
        approval: { kind: "upgrade_plan" },
        requestsUrl: null,
        idempotencyKey: "key-seat",
      });

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: "priya@acme.example", template: "seat-request" });
    });
  });
});
