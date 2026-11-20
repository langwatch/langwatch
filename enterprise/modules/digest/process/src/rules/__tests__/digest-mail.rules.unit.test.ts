// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A composed digest email rendered with its `@langwatch/mail` template into the command
 * notification sends, and refused here, before any claim, when either schema refuses it.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { type DigestPlanPressureProps, ReactEmailMailRenderer } from "@langwatch/mail";
import { describe, expect, it } from "vitest";

import type { DigestMail } from "../../channels/digest-mail.channel.ts";
import { renderDigestMail } from "../digest-mail.rules.ts";

const ONE_CLICK = "https://app.example.test/api/digest/unsubscribe?token=signed";

/** Props the plan-pressure template's schema accepts. */
const PLAN_PRESSURE: DigestPlanPressureProps = {
  weekLabel: "Nov 9 to 15",
  unsubscribeUrl: ONE_CLICK,
  organizationName: "Acme",
  usagePercentage: 90,
  used: 900,
  limit: 1_000,
  unit: "traces",
  resetsOn: "Dec 1",
  samplingUrl: "https://app.example.test/settings/usage",
  redactionUrl: "https://app.example.test/settings",
  upgradeUrl: "https://app.example.test/settings/subscription",
};

const renderer = ReactEmailMailRenderer.create();

type PlanPressureMail = Extract<DigestMail, { templateId: "digest-plan-pressure" }>;

function mail(overrides: Partial<PlanPressureMail> = {}): PlanPressureMail {
  return {
    to: "member@example.test",
    templateId: "digest-plan-pressure",
    props: PLAN_PRESSURE,
    oneClickUnsubscribeUrl: ONE_CLICK,
    idempotencyKey: "digest:user-member:2026-W46",
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
        idempotencyKey: "digest:user-member:2026-W46",
      });
      expect(rendered.email.subject).not.toBe("");
      expect(rendered.email.subject.startsWith("[Test]")).toBe(false);
      expect(rendered.email.html).toContain("<html");
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
      const props = { ...PLAN_PRESSURE, unsubscribeUrl: "not a url" };

      // The template's schema names the field it refused.
      await expect(renderDigestMail({ mail: mail({ props }), renderer })).rejects.toThrow(
        /"unsubscribeUrl"/,
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
