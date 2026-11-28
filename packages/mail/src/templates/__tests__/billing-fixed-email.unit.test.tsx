import { describe, expect, it } from "vitest";

import { billingFixedEmailProps, billingFixedEmailTemplate } from "../billing-fixed-email.tsx";
import { renderMailTemplate } from "../registry.ts";

const renderFixture = async (name: string) => {
  const fixture = billingFixedEmailTemplate.fixtures.find((each) => each.name === name);
  if (!fixture) throw new Error(`fixture missing: ${name}`);
  return renderMailTemplate(billingFixedEmailTemplate, billingFixedEmailProps.parse(fixture.props));
};

describe("the billing-fixed email", () => {
  describe("given an admin tried to make a member an Admin while billing was blocked", () => {
    /** @scenario "The billing-fixed email says what was tried, what finishing costs and that nothing was charged" */
    it("names the change, its price now and the way back to the members page", async () => {
      const { subject, html } = await renderFixture("role change");

      expect(subject).toBe("ACME's billing is fixed");
      expect(html).toContain("You tried to make Jane Doe an Admin earlier today.");
      expect(html).toContain(
        "Billing is working again, so you can finish it now: 1 more full seat, €19.33 today, then €145 a month from 1 December 2026.",
      );
      expect(html).toContain("https://app.langwatch.ai/settings/members");
      expect(html).toContain("Nothing was charged while it was blocked.");
    });
  });
});
