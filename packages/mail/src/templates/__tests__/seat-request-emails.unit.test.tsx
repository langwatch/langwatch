import { describe, expect, it } from "vitest";

import { TestMailer } from "../../__tests__/mailer.test-double.ts";
import type { EmailContent } from "../../email-sender.ts";
import {
  sendAccessNoticeDigestEmail,
  sendIdpRefusedSignInEmail,
  sendSeatRequestEmail,
} from "../seat-request-emails.tsx";

class RecordingMailer extends TestMailer {
  readonly sent: EmailContent[] = [];

  override async send(content: EmailContent): Promise<unknown> {
    this.sent.push(content);
    return undefined;
  }
}

const requestsUrl = "https://app.langwatch.ai/settings/members?tab=requests";

describe("sendSeatRequestEmail", () => {
  describe("when the identity provider also refused the person", () => {
    /** @scenario "The seat request mail says when the identity provider also refused the person" */
    it("tells the reader to assign them to the LangWatch app in that provider", async () => {
      const mailer = new RecordingMailer();

      await sendSeatRequestEmail({
        mailer,
        recipientEmail: "priya@acme.example",
        organizationName: "Acme Corp",
        personName: "Foo Bar",
        personEmail: "foo@acme.example",
        heldWithoutAccess: true,
        idpRefused: { idpName: "Okta" },
        approval: { kind: "contact_sales" },
        requestsUrl,
      });

      const [content] = mailer.sent;
      expect(content?.to).toBe("priya@acme.example");
      expect(content?.subject).toBe("Foo Bar is waiting for a seat in Acme Corp");
      expect(content?.html).toContain("assign them to the LangWatch app in Okta");
      expect(content?.html).toContain("Contact LangWatch to increase your plan");
    });
  });

  describe("when the organization pays per seat through Stripe", () => {
    it("quotes the seat price and says Stripe prorates", async () => {
      const mailer = new RecordingMailer();

      await sendSeatRequestEmail({
        mailer,
        recipientEmail: "priya@acme.example",
        organizationName: "Acme Corp",
        personName: null,
        personEmail: "foo@acme.example",
        heldWithoutAccess: false,
        idpRefused: null,
        approval: { kind: "stripe_seats", seatPrice: { amount: 29, currency: "EUR" } },
        requestsUrl,
      });

      const html = mailer.sent[0]?.html ?? "";
      expect(html).toContain("€29.00 a month");
      expect(html).toContain("Stripe charges only for the rest of this billing period");
      expect(html).not.toContain("assign them to the LangWatch app");
    });
  });
});

describe("sendIdpRefusedSignInEmail", () => {
  it("says the identity provider refused it and how to give access", async () => {
    const mailer = new RecordingMailer();

    await sendIdpRefusedSignInEmail({
      mailer,
      recipientEmail: "priya@acme.example",
      organizationName: "Acme Corp",
      personName: "Foo Bar",
      personEmail: "foo@acme.com",
      idpName: "Okta",
    });

    expect(mailer.sent[0]?.html).toContain(
      "Foo Bar (foo@acme.com) tried to sign in, but your identity provider (Okta) refused it. If they should have access, assign them to the LangWatch app in Okta.",
    );
  });
});

describe("sendAccessNoticeDigestEmail", () => {
  it("names the people and counts the rest", async () => {
    const mailer = new RecordingMailer();

    await sendAccessNoticeDigestEmail({
      mailer,
      recipientEmail: "priya@acme.example",
      organizationName: "Acme Corp",
      people: [{ name: "Foo Bar", email: "foo@acme.example", kind: "seat_request", idpName: null }],
      moreCount: 5,
      requestsUrl,
    });

    const [content] = mailer.sent;
    expect(content?.subject).toBe("6 people need access to Acme Corp");
    expect(content?.html).toContain("Foo Bar (foo@acme.example)");
    expect(content?.html).toContain("and 5 more");
  });
});
