import { describe, expect, it } from "vitest";

import { TestMailer } from "../../__tests__/mailer.test-double.ts";
import type { EmailContent } from "../../providers/types.ts";
import { sendOrganizationMfaRequirementEmail } from "../organization-mfa-requirement-email.tsx";

class RecordingMailer extends TestMailer {
  readonly sent: EmailContent[] = [];

  override async send(content: EmailContent): Promise<unknown> {
    this.sent.push(content);
    return undefined;
  }
}

describe("sendOrganizationMfaRequirementEmail", () => {
  describe("when an administrator changes the requirement", () => {
    /** @scenario "A changed two-step requirement tells each member who changed it and what it means" */
    it("tells the member who turned it on, and that a second factor is now needed", async () => {
      const mailer = new RecordingMailer();

      await sendOrganizationMfaRequirementEmail({
        mailer,
        to: "morgan@acme.example",
        organizationName: "Acme",
        actorName: "Riley Chen",
        required: true,
      });

      const [content] = mailer.sent;
      expect(content?.to).toBe("morgan@acme.example");
      expect(content?.subject).toBe("Two-step verification is now required for Acme");
      expect(content?.html).toContain(
        "Riley Chen turned on the two-step verification requirement for",
      );
      expect(content?.html).toContain("prove a second factor before opening this organization");
    });

    it("says the requirement is gone when it is turned off", async () => {
      const mailer = new RecordingMailer();

      await sendOrganizationMfaRequirementEmail({
        mailer,
        to: "morgan@acme.example",
        organizationName: "Acme",
        actorName: "Riley Chen",
        required: false,
      });

      expect(mailer.sent[0]?.subject).toBe("Two-step verification is no longer required for Acme");
      expect(mailer.sent[0]?.html).toContain("without proving a second factor");
    });
  });
});
