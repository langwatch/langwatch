import { describe, expect, it } from "vitest";

import {
  paymentRecoveryEmailProps,
  paymentRecoveryEmailTemplate,
} from "../payment-recovery-email.tsx";
import { renderMailTemplate } from "../registry.ts";

const renderFixture = async (name: string) => {
  const fixture = paymentRecoveryEmailTemplate.fixtures.find((each) => each.name === name);
  if (!fixture) throw new Error(`fixture missing: ${name}`);
  return renderMailTemplate(
    paymentRecoveryEmailTemplate,
    paymentRecoveryEmailProps.parse(fixture.props),
  );
};

describe("the payment recovery email", () => {
  describe("given an unpaid renewal before the move to Free", () => {
    /** @scenario "Every payment recovery email before the move to Free asks to update the card" */
    it.each(["payment failed", "reminder", "final warning"])(
      "labels the %s email's button Update card",
      async (name) => {
        const { html } = await renderFixture(name);

        expect(html).toContain(">Update card<");
        expect(html).not.toContain("Pay now");
      },
    );
  });

  describe("given an organization moved to the Free plan on day 21", () => {
    /** @scenario "The email after the move to Free asks to pay the open invoice" */
    it("labels the paused email's button Pay now", async () => {
      const { html } = await renderFixture("paused");

      expect(html).toContain(">Pay now<");
    });
  });
});
