/**
 * Where an accepted invitation sends its person (ADR-205 for Billing only).
 * @see ../../../../../../specs/licensing/billing-only-invite.feature
 */
import { describe, expect, it } from "vitest";

import { landingAfterAccept } from "../invite-messages.ts";

const organization = { invite: { organization: { name: "ACME" } } };

describe("landingAfterAccept", () => {
  describe("given a Billing-only invitation", () => {
    /** @scenario "A Billing-only member lands on the plan page and can open it" */
    it("lands on the plan page", () => {
      expect(landingAfterAccept({ ...organization, project: null, billingOnly: true })).toBe(
        "/settings/subscription",
      );
    });
  });

  describe("given an invitation with a project to open", () => {
    it("lands on that project", () => {
      expect(landingAfterAccept({ ...organization, project: { slug: "support-bot" } })).toBe(
        "/support-bot",
      );
    });
  });

  describe("given an invitation with no project", () => {
    it("lands home", () => {
      expect(landingAfterAccept({ ...organization, project: null })).toBe("/");
    });
  });
});
