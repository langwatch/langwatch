import { describe, expect, it } from "vitest";

import { TestMailer } from "../../__tests__/mailer.test-double.ts";
import type { EmailContent } from "../../email-sender.ts";
import { sendSsoDomainProofLapsedEmail } from "../sso-domain-proof-emails.tsx";

class RecordingMailer extends TestMailer {
  readonly sent: EmailContent[] = [];

  override async send(content: EmailContent): Promise<unknown> {
    this.sent.push(content);
    return undefined;
  }
}

describe("sendSsoDomainProofLapsedEmail", () => {
  describe("when the grace ran out and the record is still missing", () => {
    it("says what stopped and that existing members are unaffected", async () => {
      const mailer = new RecordingMailer();

      await sendSsoDomainProofLapsedEmail({
        mailer,
        adminEmail: "priya@acme.example",
        organizationName: "Acme Corp",
        domain: "acme.example",
        recordType: "TXT",
        recordName: "_langwatch-verification.acme.example",
        recordLabel: "_langwatch-verification",
        accessSettingsUrl: "https://app.langwatch.ai/settings/access",
      });

      const [content] = mailer.sent;
      expect(content?.to).toBe("priya@acme.example");
      expect(content?.subject).toBe("acme.example is no longer verified for Acme Corp");
      expect(content?.html).toContain("Everyone already in your organization can still sign in.");
      expect(content?.html).toContain("Single sign-on is untouched.");
      expect(content?.html).toContain("_langwatch-verification.acme.example");
    });
  });
});
