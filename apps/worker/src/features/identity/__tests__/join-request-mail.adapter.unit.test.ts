import { describe, expect, it } from "vitest";
import { ReactEmailMailRenderer } from "@langwatch/mail";
import type { EmailContent } from "@langwatch/notification-server";
import { JoinRequestMailAdapter } from "../join-request-mail.adapter";

/**
 * Spec: packages/features/identity/specs/join-request-worker-composition.feature
 *
 * The literals below are the twin pin, and the twin is gone: these bytes were
 * captured while this adapter wrote its own `createElement` translation of the
 * two mails, and they still pass now that the words come from
 * `@langwatch/mail`'s JSX through `MailRenderPort`. That is what the pin is
 * for — it is the evidence the move changed no message, character for
 * character, which no amount of reading two templates side by side gives you.
 *
 * The renderer is the real one rather than a double for the same reason: a
 * stub would assert the test's own strings back at itself.
 *
 * A drift here is invisible in production: two admins on one organization
 * would receive two differently-worded reminders depending on which process
 * happened to hold the wake, and nobody sees both.
 */
const REMINDER_HTML =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html dir="ltr" lang="en"><head><link rel="preload" as="image" href="https://app.langwatch.ai/images/logo-icon.png"/></head><!--$--><!--html--><table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="max-width:37.5em;border:1px solid #F2F4F8;border-radius:10px;padding:24px;padding-bottom:12px"><tbody><tr style="width:100%"><td><img alt="LangWatch Logo" src="https://app.langwatch.ai/images/logo-icon.png" style="display:block;outline:none;border:none;text-decoration:none" width="36"/><h1>A request to join is still waiting</h1><p><strong>Ada Lovelace</strong> asked to join <strong>Acme</strong> a week ago and nobody has answered yet.</p><p>It lapses in another week. This is the only reminder we send about it.</p><a href="https://langwatch.acme.example/settings/members" style="line-height:100%;text-decoration:none;display:inline-block;max-width:100%;mso-padding-alt:0px;padding:10px 20px;color:white;background-color:#ED8926;border-radius:6px;padding-top:10px;padding-right:20px;padding-bottom:10px;padding-left:20px" target="_blank"><span><!--[if mso]><i style="mso-font-width:500%;mso-text-raise:15" hidden>&#8202;&#8202;</i><![endif]--></span><span style="max-width:100%;display:inline-block;line-height:120%;mso-padding-alt:0px;mso-text-raise:7.5px">Open members settings</span><span><!--[if mso]><i style="mso-font-width:500%" hidden>&#8202;&#8202;&#8203;</i><![endif]--></span></a></td></tr></tbody></table><!--/$--></html>';

const EXPIRED_HTML =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html dir="ltr" lang="en"><head><link rel="preload" as="image" href="https://app.langwatch.ai/images/logo-icon.png"/></head><!--$--><!--html--><table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation" style="max-width:37.5em;border:1px solid #F2F4F8;border-radius:10px;padding:24px;padding-bottom:12px"><tbody><tr style="width:100%"><td><img alt="LangWatch Logo" src="https://app.langwatch.ai/images/logo-icon.png" style="display:block;outline:none;border:none;text-decoration:none" width="36"/><h1>Your request lapsed</h1><p>Nobody answered your request to join <strong>Acme</strong> on LangWatch within two weeks, so it lapsed.</p><p>You can ask again whenever you like.</p></td></tr></tbody></table><!--/$--></html>';

class RecordingMailer {
  readonly sent: EmailContent[] = [];

  defaultFrom(): string {
    return "LangWatch <contact@langwatch.ai>";
  }

  async send(content: EmailContent): Promise<unknown> {
    this.sent.push(content);
    return {};
  }
}

const compose = () => {
  const mailer = new RecordingMailer();
  return {
    mailer,
    adapter: JoinRequestMailAdapter.create({
      mailer: mailer as unknown as never,
      renderer: ReactEmailMailRenderer.create(),
      baseHost: "https://langwatch.acme.example",
    }),
  };
};

describe("given a join request that has waited a week", () => {
  describe("when the reminder is sent to an admin", () => {
    /** @scenario "Both graphs send one reminder, worded identically" */
    it("renders exactly what the application renders", async () => {
      const { adapter, mailer } = compose();
      await adapter.sendStillWaiting({
        adminEmail: "admin@acme.example",
        organizationName: "Acme",
        requesterName: "Ada Lovelace",
      });

      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]?.to).toBe("admin@acme.example");
      expect(mailer.sent[0]?.subject).toBe("Ada Lovelace is still waiting to join Acme");
      expect(mailer.sent[0]?.html).toBe(REMINDER_HTML);
    });

    /** @scenario "Both graphs send one reminder, worded identically" */
    it("links at the deployment's own members area and decides nothing by link", async () => {
      const { adapter, mailer } = compose();
      await adapter.sendStillWaiting({
        adminEmail: "admin@acme.example",
        organizationName: "Acme",
        requesterName: "Ada Lovelace",
      });

      const html = mailer.sent[0]?.html ?? "";
      expect(html).toContain('href="https://langwatch.acme.example/settings/members"');
      expect(html).not.toMatch(/href="[^"]*(approve|reject)/i);
    });
  });
});

describe("given a join request nobody answered", () => {
  describe("when the lapse notice is sent to the requester", () => {
    /** @scenario "Both graphs send one lapse notice, worded identically" */
    it("renders exactly what the application renders", async () => {
      const { adapter, mailer } = compose();
      await adapter.sendExpired({
        requesterEmail: "ada@acme.example",
        organizationName: "Acme",
      });

      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]?.to).toBe("ada@acme.example");
      expect(mailer.sent[0]?.subject).toBe("Your request to join Acme lapsed");
      expect(mailer.sent[0]?.html).toBe(EXPIRED_HTML);
    });

    /** @scenario "Both graphs send one lapse notice, worded identically" */
    it("names nobody and gives no reason", async () => {
      const { adapter, mailer } = compose();
      await adapter.sendExpired({
        requesterEmail: "ada@acme.example",
        organizationName: "Acme",
      });

      const html = mailer.sent[0]?.html ?? "";
      expect(html).toContain("You can ask again whenever you like.");
      expect(html).not.toMatch(/rejected|declined|because/i);
    });
  });
});
