// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A composed digest email rendered with its `@langwatch/mail` template into the command
 * notification sends, and refused here, before any claim, when either schema refuses it.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { mailTemplates } from "@langwatch/mail";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { DigestMail } from "../../channels/digest-mail.channel.ts";
import { renderDigestMail } from "../digest-mail.rules.ts";

const ONE_CLICK = "https://app.example.test/api/digest/unsubscribe?token=signed";

/** The template's own first fixture: props its schema accepts. */
function planPressureProps(): Record<string, unknown> {
  const template = mailTemplates.find((candidate) => candidate.id === "digest-plan-pressure");
  const fixture = template?.fixtures[0];
  if (!fixture) throw new Error("@langwatch/mail holds no digest-plan-pressure fixture");
  return z.record(z.string(), z.unknown()).parse(fixture.props);
}

function mail(overrides: Partial<DigestMail> = {}): DigestMail {
  return {
    to: "member@example.test",
    templateId: "digest-plan-pressure",
    props: { ...planPressureProps(), unsubscribeUrl: ONE_CLICK },
    oneClickUnsubscribeUrl: ONE_CLICK,
    idempotencyKey: "digest:user-member:2026-W46",
    test: false,
    ...overrides,
  };
}

describe("renderDigestMail", () => {
  describe("when the props and the envelope are valid", () => {
    it("renders the subject and html into the command notification takes", async () => {
      const rendered = await renderDigestMail(mail());

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
      const rendered = await renderDigestMail(mail({ test: true, idempotencyKey: undefined }));

      expect(rendered.email.subject.startsWith("[Test] ")).toBe(true);
      expect(rendered.email).not.toHaveProperty("idempotencyKey");
    });
  });

  describe("when the template's schema refuses the props", () => {
    it("rejects before anything is sent", async () => {
      // The template's schema names the field it refused.
      await expect(
        renderDigestMail(mail({ props: { ...planPressureProps(), unsubscribeUrl: "not a url" } })),
      ).rejects.toThrow(/"unsubscribeUrl"/);
    });
  });

  describe("when notification's command refuses the envelope", () => {
    it("rejects an unsubscribe address that is not a URL", async () => {
      const oneClickUnsubscribeUrl = "app.example.test/api/digest/unsubscribe";

      // Notification's command names the envelope field it refused, `unsubscribe.url`.
      await expect(renderDigestMail(mail({ oneClickUnsubscribeUrl }))).rejects.toThrow(
        /"unsubscribe"/,
      );
    });
  });
});
