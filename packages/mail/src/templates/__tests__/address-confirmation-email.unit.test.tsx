import { describe, expect, it } from "vitest";

import { TestMailer } from "../../__tests__/mailer.test-double.ts";
import type { EmailContent } from "../../providers/types.ts";
import { sendAddressConfirmationEmail } from "../address-confirmation-email.tsx";

/** Keeps what it was handed, so the assertion reads the envelope the provider would send. */
class RecordingMailer extends TestMailer {
  readonly sent: EmailContent[] = [];

  override async send(content: EmailContent): Promise<unknown> {
    this.sent.push(content);
    return undefined;
  }
}

describe("sendAddressConfirmationEmail", () => {
  describe("when an added address is sent its confirmation", () => {
    /** @scenario "An added address's confirmation says what happened, and where to finish it" */
    it("mails the address the link, and says it was added rather than created", async () => {
      const mailer = new RecordingMailer();

      await sendAddressConfirmationEmail({
        mailer,
        email: "morgan@acme.example",
        verificationUrl: "https://app.langwatch.ai/settings/security?confirm=idf_1&token=tok_1",
      });

      expect(mailer.sent).toHaveLength(1);
      const [content] = mailer.sent;
      expect(content?.to).toBe("morgan@acme.example");
      expect(content?.subject).toBe("Confirm this email address for LangWatch");
      expect(content?.html).toContain("confirm=idf_1&amp;token=tok_1");
      expect(content?.html).toContain("was added to a LangWatch account");
      expect(content?.html).not.toContain("creating a LangWatch account");
      expect(content?.html).toContain("same browser you added the address from");
    });
  });
});
