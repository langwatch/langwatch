/**
 * The domain-proof mails over notification's sender.
 * Spec: specs/identity/sso-domain-verification.feature
 */
import type { EmailContent } from "@langwatch/mail";
import { describe, expect, it } from "vitest";

import { SesSsoDomainProofMailChannel } from "../ses.sso-domain-proof-mail.channel.ts";

const RECORD = {
  recordType: "TXT",
  recordName: "_langwatch-verification.acme.example",
  recordLabel: "_langwatch-verification",
};

describe("SesSsoDomainProofMailChannel", () => {
  describe("when the record goes missing and later the grace runs out", () => {
    /** @scenario "The wavering and lapsed mails leave through notification with the record and the settings link" */
    it("sends each mail naming the record and linking the access settings", async () => {
      const sent: EmailContent[] = [];
      const channel = SesSsoDomainProofMailChannel.create({
        mailer: {
          send: async (content) => {
            sent.push(content);
          },
        },
        baseUrl: "https://app.langwatch.test",
      });
      const admin = {
        adminEmail: "priya@acme.example",
        organizationName: "Acme",
        domain: "acme.example",
      };

      await channel.sendProofWavering({
        ...admin,
        record: RECORD,
        graceEndsAtMs: Date.parse("2026-10-01T09:00:00.000Z"),
      });
      await channel.sendProofLapsed({ ...admin, record: RECORD });

      expect(sent.map((content) => content.to)).toEqual([
        "priya@acme.example",
        "priya@acme.example",
      ]);
      for (const content of sent) {
        expect(content.html).toContain("_langwatch-verification.acme.example");
        expect(content.html).toContain("https://app.langwatch.test/settings/access");
      }
      expect(sent[0]?.html).toContain("2026");
    });
  });
});
