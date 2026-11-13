import { describe, expect, it } from "vitest";

import { TestMailer } from "../../__tests__/mailer.test-double.ts";
import type { EmailContent } from "../../email-sender.ts";
import { sendIdpRefusedSignInEmail, sendSeatRequestEmail } from "../seat-request-emails.tsx";

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

  describe("when the person has a name, or only an address", () => {
    /** @scenario "Each mail names the person in its heading and subject" */
    it("names them in the heading and the subject", async () => {
      const mailer = new RecordingMailer();
      const base = {
        mailer,
        recipientEmail: "priya@acme.example",
        organizationName: "Acme Corp",
        heldWithoutAccess: true,
        idpRefused: null,
        approval: { kind: "upgrade_plan" as const },
        requestsUrl,
      };

      await sendSeatRequestEmail({
        ...base,
        personName: "Gus Growth",
        personEmail: "gus@acme.example",
      });
      await sendSeatRequestEmail({ ...base, personName: null, personEmail: "lee@acme.example" });

      expect(mailer.sent.map((sent) => sent.subject)).toEqual([
        "Gus Growth is waiting for a seat in Acme Corp",
        "lee@acme.example is waiting for a seat in Acme Corp",
      ]);
      expect(mailer.sent[0]?.html).toContain("Gus Growth is waiting for a seat</");
      expect(mailer.sent[1]?.html).toContain("lee@acme.example is waiting for a seat</");
      expect(mailer.sent.some((sent) => sent.html.includes("Someone"))).toBe(false);
    });
  });

  describe("when the deployment has no public origin to link from", () => {
    /** @scenario "A seat request mail goes out without a link when no public origin is set" */
    it("still sends the mail, without the review button", async () => {
      const mailer = new RecordingMailer();

      await sendSeatRequestEmail({
        mailer,
        recipientEmail: "priya@acme.example",
        organizationName: "Acme Corp",
        personName: "Gus Growth",
        personEmail: "gus@acme.example",
        heldWithoutAccess: true,
        idpRefused: null,
        approval: { kind: "upgrade_plan" },
        requestsUrl: null,
      });

      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]?.html).toContain("Gus Growth is waiting for a seat");
      expect(mailer.sent[0]?.html).not.toContain("Review the request");
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
  /** @scenario "Each mail names the person in its heading and subject" */
  it("names the person in the heading and the subject", async () => {
    const mailer = new RecordingMailer();
    const base = {
      mailer,
      recipientEmail: "priya@acme.example",
      organizationName: "Acme Corp",
      idpName: "Okta",
    };

    await sendIdpRefusedSignInEmail({
      ...base,
      personName: "Gus Growth",
      personEmail: "gus@acme.com",
    });
    await sendIdpRefusedSignInEmail({ ...base, personName: null, personEmail: "lee@acme.com" });

    expect(mailer.sent.map((sent) => sent.subject)).toEqual([
      "Gus Growth tried to sign in to LangWatch",
      "lee@acme.com tried to sign in to LangWatch",
    ]);
    expect(mailer.sent[0]?.html).toContain("Gus Growth tried to sign in to LangWatch</");
  });

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
