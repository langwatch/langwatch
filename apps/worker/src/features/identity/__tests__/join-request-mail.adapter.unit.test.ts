import { describe, expect, it } from "vitest";
import {
  ReactEmailMailRenderer,
  renderJoinRequestExpiredEmail,
  renderJoinRequestReminderEmail,
} from "@langwatch/mail";
import type { EmailContent } from "@langwatch/notification-server";
import { JoinRequestMailAdapter } from "../join-request-mail.adapter.ts";

/**
 * Spec: modules/identity/specs/join-request-worker-composition.feature
 * Verifies the adapter reaches the right renderer with the right props.
 */
const MEMBERS_URL = "https://langwatch.acme.example/settings/members";

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
      expect(mailer.sent[0]?.html).toBe(
        await renderJoinRequestReminderEmail({
          organizationName: "Acme",
          requesterName: "Ada Lovelace",
          membersSettingsUrl: MEMBERS_URL,
        }),
      );
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
      expect(mailer.sent[0]?.html).toBe(
        await renderJoinRequestExpiredEmail({ organizationName: "Acme" }),
      );
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
