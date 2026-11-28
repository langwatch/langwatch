// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A composed digest email rendered with its `@langwatch/mail` template into the command
 * notification sends, and refused here, before any claim, when either schema refuses it.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { type DigestWeekProps, ReactEmailMailRenderer } from "@langwatch/mail";
import { describe, expect, it } from "vitest";

import type { DigestMail } from "../../channels/digest-mail.channel.ts";
import { renderDigestMail } from "../digest-mail.rules.ts";

const ONE_CLICK = "https://app.example.test/api/digest/unsubscribe?token=signed";

/** Props the weekly digest's schema accepts: an admin's plan row alone. */
const PLAN_ROW: DigestWeekProps = {
  weekLabel: "Nov 9 to 15",
  preferencesUrl: ONE_CLICK,
  organizationName: "Acme",
  rows: [
    {
      kind: "plan",
      used: 900,
      limit: 1_000,
      daysLeft: 15,
      resetsOn: "Dec 1",
      url: "https://app.example.test/settings/usage",
      upgradeUrl: "https://app.example.test/settings/subscription",
    },
  ],
  folded: [],
  steadyEvals: [],
  everythingUrl: "https://app.example.test",
};

const renderer = ReactEmailMailRenderer.create();

function mail(overrides: Partial<DigestMail> = {}): DigestMail {
  return {
    to: "member@example.test",
    templateId: "digest-week",
    props: PLAN_ROW,
    oneClickUnsubscribeUrl: ONE_CLICK,
    organizationName: null,
    idempotencyKey: "digest:user-member:org-1:2026-W46",
    test: false,
    ...overrides,
  };
}

describe("renderDigestMail", () => {
  describe("when the props and the envelope are valid", () => {
    it("renders the subject and html into the command notification takes", async () => {
      const rendered = await renderDigestMail({ mail: mail(), renderer });

      expect(rendered.email).toMatchObject({
        to: "member@example.test",
        unsubscribe: { url: ONE_CLICK },
        idempotencyKey: "digest:user-member:org-1:2026-W46",
      });
      expect(rendered.email.subject).not.toBe("");
      expect(rendered.email.subject.startsWith("[Test]")).toBe(false);
      expect(rendered.email.html).toContain("<html");
    });
  });

  describe("when the email is about a named organization", () => {
    /** @scenario "A member of two organizations is sent one email per organization" */
    it("leads the subject with the organization's name, ahead of a test's marker", async () => {
      const plain = await renderDigestMail({ mail: mail(), renderer });
      const named = await renderDigestMail({ mail: mail({ organizationName: "Acme" }), renderer });
      const test = await renderDigestMail({
        mail: mail({ organizationName: "Acme", test: true, idempotencyKey: undefined }),
        renderer,
      });

      expect(named.email.subject).toBe(`Acme: ${plain.email.subject}`);
      expect(test.email.subject).toBe(`[Test] Acme: ${plain.email.subject}`);
    });

    /** @scenario "The plan row and the subject never name the organization twice" */
    it("names the organization once, in the prefix, and the plan row not at all", async () => {
      const named = await renderDigestMail({ mail: mail({ organizationName: "Acme" }), renderer });

      expect(named.email.subject).toBe("Acme: You have used 90% of this month's traces");
      expect(named.email.subject).not.toMatch(/Acme: Acme/);
    });
  });

  describe("when it is an operator's test", () => {
    it("marks the subject and carries no idempotency key", async () => {
      const rendered = await renderDigestMail({
        mail: mail({ test: true, idempotencyKey: undefined }),
        renderer,
      });

      expect(rendered.email.subject.startsWith("[Test] ")).toBe(true);
      expect(rendered.email).not.toHaveProperty("idempotencyKey");
    });
  });

  describe("when the template's schema refuses the props", () => {
    it("rejects before anything is sent", async () => {
      const props = { ...PLAN_ROW, preferencesUrl: "not a url" };

      // The template's schema names the field it refused.
      await expect(renderDigestMail({ mail: mail({ props }), renderer })).rejects.toThrow(
        /"preferencesUrl"/,
      );
    });
  });

  describe("when notification's command refuses the envelope", () => {
    it("rejects an unsubscribe address that is not a URL", async () => {
      const oneClickUnsubscribeUrl = "app.example.test/api/digest/unsubscribe";

      const rendering = renderDigestMail({ mail: mail({ oneClickUnsubscribeUrl }), renderer });

      // Notification's command names the envelope field it refused, `unsubscribe.url`.
      await expect(rendering).rejects.toThrow(/"unsubscribe"/);
    });
  });
});
