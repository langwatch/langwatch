/** @see specs/licensing/billing-only-invite.feature */
import { describe, expect, it } from "vitest";

import { growthLiteLine, liteNotOnFreeText } from "../free-plan-invite.ts";

describe("the Free notice copy", () => {
  /** @scenario "The Growth line leaves the price out when it is not known" */
  it("leaves the price out when it is not known", () => {
    expect(growthLiteLine()).toBe("Growth has unlimited Lite members.");
  });

  it("names the price per full seat when it is known", () => {
    expect(growthLiteLine("€29")).toBe(
      "Growth has unlimited Lite members, from €29/mo per full seat.",
    );
  });

  it("speaks of the person invited when several are", () => {
    expect(
      liteNotOnFreeText({ emails: ["a@acme.com", "b@acme.com"], organizationName: "ACME" }),
    ).toContain("If the person you are inviting pays for LangWatch");
  });
});
